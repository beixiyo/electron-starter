/** 构建时取自应用 package.json 的版本号。 */
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  MODE: string
  DEV: boolean
  PROD: boolean
  [K: string]: string
}