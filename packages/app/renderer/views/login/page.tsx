/**
 * 登录路由页面：Web 端保留弹窗授权，Electron 端在系统默认浏览器中发起 OAuth 授权
 */
import { INDEX_PAGE } from '@/config'
import { api } from '@/http/httpInstance'
import { UserActions } from '@/store/user'
import { isElectron } from '@/utils/env'
import { applePopupLogin, googlePopupCodeLogin } from '@jl-org/auth'
import { useNavigate } from '@jl-org/react-router'
import { Button, Message } from 'comps'
import { ClientType } from 'http-api'
import { Chrome, Layers3, Mail } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppleIcon from '../../assets/svg/apple.svg?react'
import { EmailModal } from './components/EmailModal'
import {
  APPLE_CLIENT_ID,
  APPLE_REDIRECT_URI,
  APPLE_SCOPE,
  APPLE_STATE,
  buildAppleAuthorizeUrl,
  buildClientContext,
  buildGoogleAuthorizeUrl,
  GOOGLE_CLIENT_ID,
  GOOGLE_REDIRECT_URI,
} from './constants'
import { consumeElectronOAuthCallback } from './electronOAuthCallback'
import { clearOAuthState, createOAuthState } from './oauthState'

export default function LoginPage() {
  const { t } = useTranslation('login')
  const [openEmailModal, setOpenEmailModal] = useState(false)
  const [appleLoading, setAppleLoading] = useState(false)
  const navigate = useNavigate()

  const handleEmailLogin = () => {
    setOpenEmailModal(true)
  }

  const handleLoginSuccess = useCallback(() => {
    Message.success(t('messages.loginSuccess'))
    navigate(INDEX_PAGE, { replace: true })
  }, [navigate, t])

  const handleGoogleLogin = async () => {
    if (isElectron()) {
      const state = createOAuthState({ provider: 'google', storage: localStorage })
      try {
        const googleUrl = buildGoogleAuthorizeUrl(state)
        const result = await $ipc.window.openExternal(googleUrl)
        if (!result.success) throw new Error(result.error)
      }
      catch (error) {
        clearOAuthState('google', localStorage)
        Message.danger(t('messages.loginFailed'))
        console.error(error)
      }
      return
    }

    try {
      const clientContext = buildClientContext()
      const data = await googlePopupCodeLogin({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: GOOGLE_REDIRECT_URI,
        response_mode: 'fragment',
      })

      console.log('google', data)
      const userData = await api.user.oauthLogin({
        authorization_code: data.code,
        ...clientContext,
        platform: 'google',
      })

      if (userData?.id) {
        UserActions.loggedIn(userData)
        navigate(INDEX_PAGE, { replace: true })
        Message.success(t('messages.loginSuccess'))
      }
    }
    catch (error) {
      Message.danger(t('messages.loginFailed'))
      console.error(error)
    }
  }

  const handleAppleLogin = async () => {
    if (isElectron()) {
      const state = createOAuthState({ provider: 'apple', storage: localStorage })
      try {
        const appleUrl = buildAppleAuthorizeUrl(state)
        const result = await $ipc.window.openExternal(appleUrl)
        if (!result.success) throw new Error(result.error)
      }
      catch (error) {
        clearOAuthState('apple', localStorage)
        Message.danger(t('messages.loginFailed'))
        console.error(error)
      }
      return
    }

    try {
      setAppleLoading(true)
      const response = await applePopupLogin({
        client_id: APPLE_CLIENT_ID,
        redirect_uri: APPLE_REDIRECT_URI,
        scope: APPLE_SCOPE,
        state: APPLE_STATE,
        usePopup: true,
        nonce: 'nonce',
        response_mode: 'fragment',
      })

      console.log('apple', response)
      if (response === null) {
        setAppleLoading(false)
        return
      }

      const { authorization, user } = response
      const { name } = user || {}
      const { code } = authorization
      const { firstName, lastName } = name || {}
      const clientContext = buildClientContext()

      const username = typeof firstName === 'string' && typeof lastName === 'string'
        ? `${firstName} ${lastName}`
        : null

      const userData = await api.user.oauthLogin({
        authorization_code: code!,
        ...clientContext,
        platform: 'apple',
        username,
      })

      if (userData?.id) {
        UserActions.loggedIn(userData)
        navigate(INDEX_PAGE, { replace: true })
        Message.success(t('messages.loginSuccess'))
      }
    }
    catch (error) {
      Message.danger(t('messages.loginFailed'))
      console.error(error)
    }
    finally {
      setAppleLoading(false)
    }
  }

  // ======================
  // * Electron Login
  // ======================
  useEffect(() => {
    if (!isElectron()) {
      return
    }

    let active = true
    type OAuthCallbackDelivery = Awaited<ReturnType<typeof $ipc.oauth.registerReceiver>>[number]
    const handleOAuthCallback = async (delivery: OAuthCallbackDelivery) => {
      if (!active) return

      const { id, params } = delivery
      const callback = consumeElectronOAuthCallback(params, localStorage)
      await $ipc.oauth.acknowledgeCallback(id).catch(() => {})

      if (!callback.ok) {
        if (callback.reason !== 'unsupported_provider' && callback.reason !== 'access_denied') Message.danger(t('messages.loginFailed'))
        return
      }

      try {
        setAppleLoading(callback.provider === 'apple')
        const clientContext = buildClientContext()
        const userData = await api.user.oauthLogin({
          authorization_code: callback.authorizationCode,
          state: callback.state,
          ...clientContext,
          platform: callback.provider,
          /** 该回调仅在 Electron 端注册（上方已 isElectron 守卫），固定为 Desktop */
          client_type: ClientType.Desktop,
          username: callback.username,
        })

        if (userData?.id) {
          UserActions.loggedIn(userData)
          handleLoginSuccess()
        }
      }
      catch (error) {
        Message.danger(t('messages.loginFailed'))
        console.error(error)
      }
      finally {
        setAppleLoading(false)
      }
    }

    const cleanup = $ipc.oauth.on('callbackDelivery', handleOAuthCallback)
    void $ipc.oauth.registerReceiver().then((pendingCallbacks) => {
      for (const pendingCallback of pendingCallbacks) void handleOAuthCallback(pendingCallback)
    }).catch(() => {
      Message.danger(t('messages.loginFailed'))
    })

    return () => {
      active = false
      cleanup?.()
      void $ipc.oauth.unregisterReceiver().catch(() => {})
    }
  }, [handleLoginSuccess, t])

  return (
    <div className="flex min-h-screen overflow-hidden bg-background text-text">
      <EmailModal
        open={ openEmailModal }
        onClose={ () => setOpenEmailModal(false) }
        onSuccess={ handleLoginSuccess }
      />

      { /* 左侧品牌区：实际项目可替换为自己的 logo 或品牌动画 */ }
      <div className="relative hidden flex-1 items-center justify-center overflow-hidden bg-background3 md:flex">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgb(255_255_255)_0%,rgb(247_240_247)_42%,rgb(var(--background3)/1)_74%)] dark:opacity-10" />
        <div className="relative flex flex-col items-center gap-5">
          <div className="flex size-24 items-center justify-center rounded-[28px] bg-button text-button3 shadow-card">
            <Layers3 size={ 42 } strokeWidth={ 1.5 } aria-hidden />
          </div>
          <span className="text-sm font-medium tracking-[0.18em] text-text3">DESKTOP APP</span>
        </div>
      </div>

      { /* 右侧登录入口 */ }
      <div className="relative flex min-h-screen min-w-0 flex-1 items-center justify-center px-8 py-16">
        <div className="w-full max-w-85">
          <div className="mb-8">
            <h1 className="text-[28px] font-medium leading-9 text-text">{ t('title') }</h1>
            <p className="mt-2 text-sm text-text3">{ t('subtitle') }</p>
          </div>

          <div className="space-y-4">
            <Button
              variant="primary"
              size="lg"
              block
              onClick={ handleAppleLogin }
              leftIcon={ <AppleIcon /> }
              className="h-14 justify-start rounded-[10px] px-6 shadow-button"
              iconClassName="mr-3"
              disabled={ appleLoading }
            >
              { t('appleLogin') }
            </Button>

            <Button
              variant="default"
              size="lg"
              block
              onClick={ handleGoogleLogin }
              leftIcon={ <Chrome size={ 22 } /> }
              className="h-14 justify-start rounded-[10px] bg-background px-6 shadow-[0_4px_20px_rgba(0,0,0,0.07)] hover:bg-background2"
              iconClassName="mr-4"
            >
              { t('googleLogin') }
            </Button>

            <Button
              variant="default"
              size="lg"
              block
              onClick={ handleEmailLogin }
              leftIcon={ <Mail size={ 22 } /> }
              className="h-14 justify-start rounded-[10px] bg-background px-6 shadow-[0_4px_20px_rgba(0,0,0,0.07)] hover:bg-background2"
              iconClassName="mr-4"
            >
              { t('emailLogin') }
            </Button>
          </div>

          <div className="mt-9 text-center text-[11px] leading-4 text-text3">
            { t('agreement') }{' '}
            <a
              href="https://www.$APP_PROTOCOL.ai/policies/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-info hover:underline"
            >
              { t('termsOfService') }
            </a>
            { ` ${t('and')} ` }
            <a
              href="https://www.$APP_PROTOCOL.ai/policies/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-info hover:underline"
            >
              { t('privacyPolicy') }
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
