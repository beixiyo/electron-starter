/**
 * API 通用类型定义
 *
 * 约定：
 * - 分页请求参数使用 `page` 与 `page_size`
 * - 分页响应推荐使用 `PagedResponse<T>`（包含 `list` 与 `page` 元信息）
 * - 非分页列表可直接使用 `ListResponse<T>`
 */

/**
 * 基础可空类型工具
 */
export type Nullable<T> = T | null

/**
 * 排序方向
 * @default 'desc'
 */
export type SortOrder = 'asc' | 'desc'

/**
 * 分页参数（查询）
 * @default page 1
 * @default page_size 20
 */
export type PageParams = {
  /**
   * 页码，从 1 开始
   * @default 1
   */
  page?: number
  /**
   * 每页条数
   * @default 20
   */
  page_size?: number
}

/**
 * 分页元信息（响应）
 */
export type PageMeta = {
  /**
   * 当前页码
   */
  page: number
  /**
   * 每页条数
   */
  page_size: number
  /**
   * 总条数
   */
  total: number
  /**
   * 总页数（如后端未返回，可不填）
   */
  total_page?: number
}

/**
 * 分页响应（推荐的统一结构）
 * 搭配 `PageParams` 使用
 */
export type PagedResponse<T> = {
  /**
   * 数据列表
   */
  list: T[]
  /**
   * 分页信息
   */
  page: PageMeta
}

/**
 * 非分页列表响应（仅数据数组）
 */
export type ListResponse<T> = T[]

/**
 * 通用接口响应结构
 */
export type ApiResponse<T> = {
  /**
   * 业务状态码
   */
  code: number
  /**
   * 描述信息
   */
  msg: string
  /**
   * 业务数据
   */
  data: T
}

/**
 * 通用错误结构
 */
export type ApiError = {
  /**
   * HTTP 状态码或业务错误码
   */
  code: number | string
  /**
   * 错误信息
   */
  message: string
  /**
   * 追踪标识（如有）
   */
  trace_id?: string
  /**
   * 错误详情（如有）
   */
  details?: unknown
}

/**
 * 通用主键参数
 */
export type IdParam = number | string
