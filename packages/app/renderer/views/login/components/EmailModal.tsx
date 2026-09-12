import { api } from '@/http/httpInstance'
import { UserActions } from '@/store/user'
import { Button, Form, Input, Message, Modal, useForm } from 'comps'
import { X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from 'utils'

interface EmailModalProps {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
}

/**
 * 邮箱登录弹窗组件
 */
export function EmailModal({ open, onClose, onSuccess }: EmailModalProps) {
  const draftRef = useRef<EmailLoginDraft>(createEmptyDraft())

  /** 表单校验规则 */
  const validators = {
    email: (value: string) => {
      if (!value) return '请输入邮箱地址'
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      return emailRegex.test(value)
        ? undefined
        : '请输入有效的邮箱地址'
    },
    code: (value: string) => {
      return value
        ? undefined
        : '请输入验证码'
    },
  }

  return (
    <Modal
      isOpen={ open }
      onClose={ onClose }
      width={ 480 }
      header={ null }
      footer={ null }
      clickOutsideClose={ false }
      enterToConfirm={ false }
    >
      <Form
        initialValues={ {
          email: draftRef.current.email,
          code: draftRef.current.code,
        } }
        validators={ validators }
        onSubmit={ async (values, form) => {
          try {
            const response = await api.user.loginByEmail({
              email: values.email,
              captcha: values.code,
              clientName: 'web',
              osVersion: 'web',
              clientModelName: 'web',
            })
            if (response?.id) {
              UserActions.loggedIn(response)
              draftRef.current = createEmptyDraft()
              onSuccess?.()
              onClose()
              form.resetForm()
            }
          }
          catch (error: any) {
            const message = error?.message || '登录失败'
            form.setFieldError('code', message)
            Message.danger(message)
          }
        } }
      >
        <EmailFormContent onClose={ onClose } draft={ draftRef.current } />
      </Form>
    </Modal>
  )
}

/** 内部表单内容组件：使用 useForm 获取状态，渲染输入与按钮 */
function EmailFormContent({ onClose, draft }: EmailFormContentProps) {
  const {
    state,
    validateField,
    setFieldTouched,
    setFieldError,
  } = useForm()
  const [countdown, setCountdown] = useState(() => getRemainingSeconds(draft.codeCooldownEndsAt))
  const [isSending, setIsSending] = useState(false)
  const mountedRef = useRef(true)
  const requestIdRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestIdRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (!countdown) return

    const timer = window.setInterval(() => {
      const remaining = getRemainingSeconds(draft.codeCooldownEndsAt)
      setCountdown(remaining)
      if (!remaining) window.clearInterval(timer)
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [countdown, draft])

  const canSubmit = Boolean(state.values.email) && Boolean(state.values.code) && state.isValid

  const disableSendCode = useMemo(() => {
    return isSending || countdown > 0 || !state.values.email
  }, [countdown, isSending, state.values.email])

  const handleSendCode = async () => {
    setFieldTouched('email', true)
    const isEmailValid = validateField('email')
    if (!isEmailValid) return

    const requestId = ++requestIdRef.current
    const email = state.values.email

    try {
      setIsSending(true)
      await api.user.getVerificationCode({ email })
      if (!mountedRef.current || requestId !== requestIdRef.current) return

      Message.success('验证码已发送，请查收邮箱')
      draft.codeCooldownEndsAt = Date.now() + CODE_COOLDOWN_SECONDS * 1000
      setCountdown(getRemainingSeconds(draft.codeCooldownEndsAt))
    }
    catch (error: any) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return

      const message = error?.message || '验证码发送失败'
      setFieldError('email', message)
      Message.danger(message)
    }
    finally {
      if (mountedRef.current && requestId === requestIdRef.current) setIsSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      { /* 头部 */ }
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-textPrimary">邮箱登录</h2>
        <button
          type="button"
          aria-label="关闭邮箱登录"
          onClick={ onClose }
          className={ cn(
            'flex items-center justify-center w-8 h-8 rounded-full',
            'hover:bg-defaultBgColor transition-colors',
            'text-textSecondary hover:text-textPrimary',
          ) }
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      { /* 表单 */ }
      <div className="flex flex-col gap-4">
        { /* 邮箱输入 */ }
        <div className="flex flex-col gap-2">
          <Input
            name="email"
            type="email"
            placeholder="请输入邮箱地址"
            className="flex-1"
            autoFocus
            onChange={ (value) => {
              draft.email = value
            } }
          />
        </div>

        { /* 验证码输入 */ }
        <div className="flex flex-col gap-2">
          <div className="flex gap-3">
            <Input
              name="code"
              type="text"
              placeholder="请输入验证码"
              className="flex-1"
              onChange={ (value) => {
                draft.code = value
              } }
            />
            <Button
              type="button"
              variant="ghost"
              disabled={ disableSendCode }
              loading={ isSending }
              onClick={ handleSendCode }
              className="whitespace-nowrap flex-1"
            >
              { countdown > 0
                ? `${countdown}s 后重试`
                : '获取验证码' }
            </Button>
          </div>
        </div>

        { /* 登录按钮 */ }
        <Button
          type="submit"
          disabled={ !canSubmit }
          loading={ state.isSubmitting }
          variant="primary"
          size="lg"
          block
          className="mt-2"
        >
          登录
        </Button>
      </div>
    </div>
  )
}

const CODE_COOLDOWN_SECONDS = 60

function createEmptyDraft(): EmailLoginDraft {
  return { email: '', code: '', codeCooldownEndsAt: 0 }
}

function getRemainingSeconds(endsAt: number): number {
  return Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
}

type EmailLoginDraft = {
  email: string
  code: string
  codeCooldownEndsAt: number
}

type EmailFormContentProps = {
  onClose: () => void
  draft: EmailLoginDraft
}
