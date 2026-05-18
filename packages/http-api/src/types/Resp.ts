export interface Resp<T = any> {
  success: boolean
  code: number
  msg: string
  data: T
  timestamp: number
}
