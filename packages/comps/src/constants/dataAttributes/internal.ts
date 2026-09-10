/**
 * 多个组件共用、但不对外承诺稳定性的内部 DOM 定位属性名
 *
 * 标注「预留」的条目当前没有任何组件写入
 */
export const INTERNAL_DATA_ATTR = {
  chatInput: {
    /** ChatInput 浮层面板的种类：prompt / history / autocomplete */
    panel: 'data-vv-chat-input-panel',
  },
  mdEditor: {
    /** MdEditor 分栏面板的种类：editor / preview */
    panel: 'data-vv-md-editor-panel',
  },
  virtual: {
    /**
     * 虚拟列表行的下标
     *
     * 与 TanStack Virtual 自己要求的 `data-index` 并存，不能取而代之：
     * `measureElement` 通过 `options.indexAttribute`（默认 `data-index`）反查行号
     */
    itemIndex: 'data-vv-virtual-item-index',
    /** 预留：尺寸正由收放动画驱动的行，当前无组件写入 */
    driven: 'data-vv-virtual-driven',
  },
} as const
