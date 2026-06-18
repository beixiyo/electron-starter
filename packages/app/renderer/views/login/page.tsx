import { applePopupLogin, googlePopupCodeLogin } from '@jl-org/auth'
import { useNavigate } from '@jl-org/react-router'
import type { OAuthCallbackParams } from '@shared'
import { WindowType } from '@shared'
import { Button, Message } from 'comps'
import { ClientType } from 'http-api'
import { Chrome, Mail } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from 'utils'
import { INDEX_PAGE } from '@/config'
import { api } from '@/http/httpInstance'
import { UserActions } from '@/store/user'
import { isElectron } from '@/utils/env'
import AppleIcon from '../../assets/svg/apple.svg?react'
import { EmailModal } from './components/EmailModal'
import { APPLE_CLIENT_ID, APPLE_REDIRECT_URI, APPLE_SCOPE, APPLE_STATE, buildAppleAuthorizeUrl, buildClientContext, buildGoogleAuthorizeUrl, GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI } from './constants'

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
      try {
        const googleUrl = buildGoogleAuthorizeUrl()
        await $ipc.window.destroy(WindowType.OAUTH)
        await $ipc.window.create(WindowType.OAUTH, {
          initialUrl: googleUrl,
        })
      }
      catch (error) {
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
      try {
        const appleUrl = buildAppleAuthorizeUrl()
        await $ipc.window.destroy(WindowType.OAUTH)
        await $ipc.window.create(WindowType.OAUTH, {
          initialUrl: appleUrl,
        })
      }
      catch (error) {
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

    const cleanup = $ipc.oauth.on('callback', async (params: OAuthCallbackParams) => {
      if (params.provider !== 'apple' && params.provider !== 'google') {
        return
      }

      if (params.error || !params.code) {
        Message.danger(t('messages.loginFailed'))
        console.error('OAuth callback failed:', params)
        await $ipc.window.destroy(WindowType.OAUTH)
        return
      }

      try {
        setAppleLoading(params.provider === 'apple')
        const clientContext = buildClientContext()
        const userData = await api.user.oauthLogin({
          authorization_code: params.code,
          ...clientContext,
          platform: params.provider,
          /** 该回调仅在 Electron 端注册（上方已 isElectron 守卫），固定为 Desktop */
          client_type: ClientType.Desktop,
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
        await $ipc.window.destroy(WindowType.OAUTH)
      }
    })

    return () => {
      cleanup?.()
    }
  }, [handleLoginSuccess, t])

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-background">
      <EmailModal
        open={ openEmailModal }
        onClose={ () => setOpenEmailModal(false) }
        onSuccess={ handleLoginSuccess }
      />

      {/* 左侧品牌/动效区（接入 Lottie 动效） */ }
      <div
        className={ cn(
          'lg:flex items-center justify-center',
          'bg-gradient-to-br from-defaultBgColor to-transparent',
          'border-r border-border',
        ) }
      >
        Lottie 动效
      </div>

      {/* 右侧登录入口 */ }
      <div className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
          <div className="mb-10">
            <h1 className="text-3xl font-bold text-textPrimary">{ t('title') }</h1>
            <p className="mt-2 text-textSecondary">{ t('subtitle') }</p>
          </div>

          <div className="space-y-4">
            <Button
              variant="default"
              size="lg"
              block
              onClick={ handleAppleLogin }
              leftIcon={ <AppleIcon /> }
              className="gap-4"
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
              className="gap-4"
            >
              { t('googleLogin') }
            </Button>

            <Button
              variant="default"
              size="lg"
              block
              onClick={ handleEmailLogin }
              leftIcon={ <Mail size={ 22 } /> }
              className="gap-4"
            >
              { t('emailLogin') }
            </Button>
          </div>

          <div className="mt-10 text-center text-sm text-textSecondary">
            { t('agreement') }
            { ' ' }
            <a
              href="https://www.$APP_PROTOCOL.ai/policies/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-textPrimary hover:underline"
            >
              { t('termsOfService') }
            </a>
            { ` ${t('and')} ` }
            <a
              href="https://www.$APP_PROTOCOL.ai/policies/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-textPrimary hover:underline"
            >
              { t('privacyPolicy') }
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
