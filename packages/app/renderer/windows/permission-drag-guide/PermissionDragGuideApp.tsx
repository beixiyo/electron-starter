import type { PermissionDragGuidePhase, PermissionDragKind } from '@shared'
import { ArrowUp, Check, ChevronLeft, Info } from 'lucide-react'
import { memo, useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { cn } from 'utils'
import { useDragGuideActions, useDragGuideState } from './useDragGuideState'

/**
 * 系统权限拖拽引导卡片
 *
 * 复刻 Codex Computer Use 的授权引导：贴在「系统设置」隐私面板上，
 * 用一个箭头 + 一枚可拖拽的应用图标，把「请到列表里找到本应用再打开右侧开关」
 * 这条用户经常摸不到落点的指令，换成一次明确的拖放
 *
 * 毛玻璃底不在这里画：
 * 窗口自带 vibrancy 材质，本组件的根元素保持透明，只负责画其上的内容
 *
 * 这里只负责画和转发意图；开面板、贴位置、判定授权都在主进程
 * `main/permissions/drag-guide` 里
 */
export const PermissionDragGuideApp = memo(() => {
  const { t } = useTranslation('windows')
  const payload = useDragGuideState()
  const { startDrag, dismiss } = useDragGuideActions()
  const systemDark = payload?.systemDark ?? false

  /**
   * 文字深浅跟随底下 vibrancy 材质，真值由主进程按 nativeTheme 给出
   *
   * Tailwind 的 `dark:` 按 `.dark` class 生效（darkMode: 'class'），
   * 渲染层自己既读不到材质颜色，prefers-color-scheme 也不驱动这些工具类，只能在这里打 class
   */
  useEffect(() => {
    document.documentElement.classList.toggle('dark', systemDark)
  }, [systemDark])

  if (!payload) {
    return null
  }

  const { appName, iconDataUrl, draggable, phase, kind } = payload
  const permissionLabel = t(`permissionDragGuide.permission.${kind}` satisfies PermissionLabelKey<typeof kind>)
  const canDrag = draggable && phase === 'waiting'

  return (
    /** 窗口即卡片：vibrancy 已把整个窗口做成毛玻璃，内容直接铺满 */
    <div className="fixed inset-0 select-none">
      {
        /**
         * 标题行：left 74 / top 16 / 高 48，箭头 38px 与文字间距 8
         * 文字允许折成两行：英文的「屏幕与系统音频录制」一行放不下，截断会把权限名吃掉
         */
      }
      <div className="absolute left-18.5 right-4 top-4 flex h-12 items-center gap-2">
        <PhaseGlyph phase={ phase } />
        <p
          className={ cn(
            'min-w-0 text-[16px] leading-[1.4]',
            'line-clamp-2 [word-break:break-word]',
            'text-black/92 dark:text-white/92',
          ) }
        >
          { phase === 'waiting'
            ? (
              <Trans
                t={ t }
                i18nKey="permissionDragGuide.headline"
                values={ { app: appName, permission: permissionLabel } }
                components={ { app: <span className="font-semibold" /> } }
              />
            )
            : t(`permissionDragGuide.${phase}`, { permission: permissionLabel }) }
        </p>
      </div>

      { /** 动作行：left/right 22 / top 74 / 高 52，返回键与拖拽胶囊间距 20 */ }
      <div className="absolute left-5.5 right-5.5 top-18.5 flex h-13 items-center gap-5">
        <button
          type="button"
          aria-label={ t('permissionDragGuide.dismiss') }
          onClick={ dismiss }
          className={ cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full transition-colors',
            'bg-white text-[#5c5c60] hover:bg-[#f2f2f4] hover:text-black',
            'dark:bg-white/12 dark:text-white/70 dark:hover:bg-white/18 dark:hover:text-white',
          ) }
        >
          <ChevronLeft size={ 18 } strokeWidth={ 1.8 } />
        </button>

        <div
          onMouseDown={ canDrag
            ? startDrag
            : undefined }
          onDragStart={ preventNativeDrag }
          title={ draggable
            ? undefined
            : t('permissionDragGuide.noBundle') }
          className={ cn(
            'flex h-13 min-w-0 flex-1 items-center gap-3 rounded-xl px-3.5',
            'bg-white dark:bg-white/12',
            canDrag
              ? 'cursor-grab active:cursor-grabbing'
              : 'cursor-default opacity-60',
          ) }
        >
          { iconDataUrl
            ? (
              <img
                src={ iconDataUrl }
                alt=""
                draggable={ false }
                className="size-7 shrink-0 rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.15)]"
              />
            )
            : <span className="size-7 shrink-0 rounded-lg bg-black/10 dark:bg-white/10" /> }

          <span className="truncate text-[16px] font-medium text-[#0e0e10] dark:text-white/90">
            { appName }
          </span>
        </div>
      </div>
    </div>
  )
})

PermissionDragGuideApp.displayName = 'PermissionDragGuideApp'

/** 三个阶段共用同一个 38px 位置与尺寸，只换图形与颜色，避免切换时布局跳动 */
const PhaseGlyph = memo<{ phase: PermissionDragGuidePhase }>(({ phase }) => (
  <span className="flex size-9.5 shrink-0 items-center justify-center">
    { phase === 'granted' && <Check size={ 30 } strokeWidth={ 2.6 } className="text-[#30d158]" /> }
    { phase === 'unconfirmed' && <Info size={ 30 } strokeWidth={ 2.4 } className="text-[#ff9f0a]" /> }
    { phase === 'waiting' && <ArrowUp size={ 30 } strokeWidth={ 2.6 } className="text-[#5560f5]" /> }
  </span>
))

PhaseGlyph.displayName = 'PhaseGlyph'

/**
 * 拦掉浏览器自己的 HTML5 拖拽
 *
 * 真正的拖拽由主进程 `webContents.startDrag` 接管；不拦的话两套拖拽会同时启动，
 * 光标下会多出一个由 Chromium 画的、根本落不进系统设置的幽灵图像
 */
function preventNativeDrag(event: React.DragEvent): void {
  event.preventDefault()
}

type PermissionLabelKey<K extends PermissionDragKind> = `permissionDragGuide.permission.${K}`
