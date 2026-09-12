// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createContext, useContext, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmailModal } from './EmailModal'

const loginMocks = vi.hoisted(() => ({
  getVerificationCode: vi.fn(),
  loginByEmail: vi.fn(),
  loggedIn: vi.fn(),
}))

vi.mock('@/http/httpInstance', () => ({
  api: { user: loginMocks },
}))

vi.mock('@/store/user', () => ({
  UserActions: { loggedIn: loginMocks.loggedIn },
}))
vi.mock('comps', () => {
  const FormContext = createContext<any>(null)

  function Form({ children, initialValues, onSubmit, validators = {} }: any) {
    const [values, setValues] = useState(initialValues)
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [isSubmitting, setIsSubmitting] = useState(false)

    const validateField = (name: string) => {
      const error = validators[name]?.(values[name])
      setErrors((previous) => ({
        ...previous,
        ...(error
          ? { [name]: error }
          : {}),
      }))
      return !error
    }
    const context = {
      state: { values, errors, isSubmitting, isValid: Object.keys(errors).length === 0 },
      setFieldValue: (name: string, value: string) => setValues((previous) => ({ ...previous, [name]: value })),
      setFieldError: (name: string, error: string) => setErrors((previous) => ({ ...previous, [name]: error })),
      setFieldTouched: () => {},
      validateField,
      resetForm: (nextValues = initialValues) => {
        setValues(nextValues)
        setErrors({})
      },
    }

    return (
      <FormContext.Provider value={ context }>
        <form
          onSubmit={ async (event) => {
            event.preventDefault()
            const valid = Object.keys(validators).every(validateField)
            if (!valid) return
            setIsSubmitting(true)
            await onSubmit(values, context)
            setIsSubmitting(false)
          } }
        >
          { children }
        </form>
      </FormContext.Provider>
    )
  }

  function Input({ name, onChange, value, ...props }: any) {
    const form = useContext(FormContext)
    const actualValue = value ?? form?.state.values[name] ?? ''
    return (
      <input
        { ...props }
        name={ name }
        value={ actualValue }
        onChange={ (event) => {
          form?.setFieldValue(name, event.target.value)
          onChange?.(event.target.value)
        } }
      />
    )
  }

  return {
    Button: ({ children, disabled, loading, onClick, type = 'button' }: any) => (
      <button disabled={ disabled || loading } type={ type } onClick={ onClick }>{ children }</button>
    ),
    Form,
    Input,
    Message: { danger: () => {}, success: () => {} },
    Modal: ({ children, isOpen }: any) =>
      isOpen
        ? <div role="dialog">{ children }</div>
        : null,
    useForm: () => useContext(FormContext),
  }
})
vi.mock('styles/variable', () => ({ default: new Proxy({}, { get: () => '' }) }))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  loginMocks.getVerificationCode.mockReset()
  loginMocks.loginByEmail.mockReset()
  loginMocks.loggedIn.mockReset()
})

function LoginHarness() {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button onClick={ () => setOpen(true) }>Reopen</button>
      <EmailModal open={ open } onClose={ () => setOpen(false) } />
    </>
  )
}

describe('EmailModal', () => {
  it('keeps the email, code and absolute cooldown after close and reopen', async () => {
    loginMocks.getVerificationCode.mockResolvedValue({})
    render(<LoginHarness />)

    const email = screen.getByPlaceholderText('请输入邮箱地址')
    const code = screen.getByPlaceholderText('请输入验证码')
    fireEvent.change(email, { target: { value: 'person@example.test' } })
    fireEvent.change(code, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /后重试/ })).toBeTruthy())

    const closeButton = screen.getAllByRole('button').find((button) => !button.textContent?.trim())
    expect(closeButton).toBeTruthy()
    fireEvent.click(closeButton!)
    await waitFor(() => expect(screen.queryByPlaceholderText('请输入邮箱地址')).toBeNull())
    vi.setSystemTime(Date.now() + 2_000)
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))

    expect(screen.getByDisplayValue('person@example.test')).toBeTruthy()
    expect(screen.getByDisplayValue('123456')).toBeTruthy()
    expect(screen.getByRole('button', { name: /5[0-8]s 后重试/ })).toBeTruthy()
  })

})
