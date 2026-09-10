/**
 * 对外稳定的组件 DOM 属性名
 *
 * ARIA 属性负责可访问性语义；这些 `data-*` 属性仅用于外部样式和 DOM 查询契约
 * 所有属性使用 `data-vv-*` 命名空间，避免与业务代码及其他组件库冲突
 *
 * 标注「预留」的条目当前没有任何组件写入，按名字查 DOM 查不到，等对应组件补齐后才会出现
 */
export const DATA_ATTR = {
  /** 预留：组件开关 / 选中态的通用状态标记，当前无组件写入 */
  state: 'data-vv-state',
  /** 预留：通用选中标记，当前无组件写入 */
  selected: 'data-vv-selected',
  /** 预留：通用键盘高亮标记，当前无组件写入 */
  highlighted: 'data-vv-highlighted',
  /** 预留：通用禁用标记，当前无组件写入 */
  disabled: 'data-vv-disabled',
  /** 预留：通用校验失败标记，当前无组件写入 */
  invalid: 'data-vv-invalid',
  /** 预留：通用拖拽中标记，当前无组件写入 */
  dragging: 'data-vv-dragging',
  /** 预留：表头排序方向标记，当前无组件写入 */
  sort: 'data-vv-sort',

  /** 浮层箭头元素，由 FloatingArrow 写入 */
  floatingArrow: 'data-vv-floating-arrow',

  bottomGlow: {
    /** 预留：辉光缩放档位，当前无组件写入 */
    scale: 'data-vv-bottom-glow-scale',
    /** 辉光位置，由 BottomGlow 写入 */
    position: 'data-vv-bottom-glow-position',
  },

  button: {
    /** 按钮组内的按钮标识，ButtonGroup 据此定位活动按钮 */
    name: 'data-vv-button-name',
  },

  cascader: {
    /** 当前选中的选项，用于自动滚动 */
    selected: 'data-vv-cascader-selected',
    /** 菜单滚动容器，用于自动滚动 */
    menu: 'data-vv-cascader-menu',
    /** 参与键盘与滚动定位的选项 */
    option: 'data-vv-cascader-option',
  },

  collapsibleSidebar: {
    /** 侧边栏是否收起 */
    collapsed: 'data-vv-collapsible-sidebar-collapsed',
  },

  datePicker: {
    /** 标记为 DatePicker 自身的一部分，点击时不触发「点击外部关闭」 */
    ignore: 'data-vv-date-picker-ignore',
    /** 日期单元格在区间中的位置：start / middle / end */
    rangePosition: 'data-vv-date-picker-range-position',
    /** 预留：快捷时间浮层的触发器，当前无组件写入 */
    quickTimeTrigger: 'data-vv-date-picker-quick-time-trigger',
    /** 预留：快捷时间浮层的忽略区域，当前无组件写入 */
    quickTimeIgnore: 'data-vv-date-picker-quick-time-ignore',
    /** 时间片段输入框所属的单位（时 / 分 / 秒） */
    timeSegment: 'data-vv-date-picker-time-segment',
    /** 预留：时间片段控件容器，当前无组件写入 */
    timeSegmentControl: 'data-vv-date-picker-time-segment-control',
    /** 预留：时间片段分组容器，当前无组件写入 */
    timeSegmentGroup: 'data-vv-date-picker-time-segment-group',
  },

  message: {
    /** 堆叠消息项的 id，useStackOverflow 据此测量存活项高度 */
    id: 'data-vv-message-id',
  },

  modal: {
    /** 该层弹窗是否位于栈顶 */
    top: 'data-vv-modal-top',
  },

  tabs: {
    /** 面板是否为当前激活项 */
    active: 'data-vv-tabs-active',
    /** 标签头的自定义标识 */
    id: 'data-vv-tabs-id',
  },
} as const
