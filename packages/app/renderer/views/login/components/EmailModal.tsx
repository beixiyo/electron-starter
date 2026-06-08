import { Button, Form, Input, Message, Modal, useForm } from 'comps'
import { X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cn } from 'utils'
import { api } from '@/http/httpInstance'
import { UserActions } from '@/store/user'

interface EmailModalProps {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
}

/**
 * 邮箱登录弹窗组件
 */
export function EmailModal({ open, onClose, onSuccess }: EmailModalProps) {
  /** 表单校验规则 */
  const validators = {
    email: (value: string) => {
      if (!value)
        return '请输入邮箱地址'
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
    >
      <Form
        key={ open
          ? 'open'
          : 'closed' }
        initialValues={ { email: '', code: '' } }
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
        <EmailFormContent onClose={ onClose } />
      </Form>
    </Modal>
  )
}

/** 内部表单内容组件：使用 useForm 获取状态，渲染输入与按钮 */
function EmailFormContent({ onClose }: { onClose: () => void }) {
  const {
    state,
    validateField,
    setFieldTouched,
    setFieldError,
  } = useForm()
  const [countdown, setCountdown] = useState(0)
  const [isSending, setIsSending] = useState(false)

  /** 打开/关闭变化时，这里不做额外处理，重置由父级传入的 key 触发 */
  useEffect(() => { }, [])

  useEffect(() => {
    if (!countdown)
      return

    const timer = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [countdown])

  const canSubmit = Boolean(state.values.email) && Boolean(state.values.code) && state.isValid

  const disableSendCode = useMemo(() => {
    return isSending || countdown > 0 || !state.values.email
  }, [countdown, isSending, state.values.email])

  const handleSendCode = async () => {
    setFieldTouched('email', true)
    const isEmailValid = validateField('email')
    if (!isEmailValid)
      return

    try {
      setIsSending(true)
      await api.user.getVerificationCode({ email: state.values.email })
      Message.success('验证码已发送，请查收邮箱')
      setCountdown(60)
    }
    catch (error: any) {
      const message = error?.message || '验证码发送失败'
      setFieldError('email', message)
      Message.danger(message)
    }
    finally {
      setIsSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 头部 */ }
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-textPrimary">邮箱登录</h2>
        <button
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

      {/* 表单 */ }
      <div className="flex flex-col gap-4">
        {/* 邮箱输入 */ }
        <div className="flex flex-col gap-2">
          <Input
            name="email"
            type="email"
            placeholder="请输入邮箱地址"
            className="flex-1"
          />
        </div>

        {/* 验证码输入 */ }
        <div className="flex flex-col gap-2">
          <div className="flex gap-3">
            <Input
              name="code"
              type="text"
              placeholder="请输入验证码"
              className="flex-1"
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

        {/* 登录按钮 */ }
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
