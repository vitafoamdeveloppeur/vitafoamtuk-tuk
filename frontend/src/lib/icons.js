// Correspondance noms historiques (Material) → Bootstrap Icons.
// Les pages continuent d'appeler <Icon name="payments" /> : seule la police change.
export const ICONS = {
  // navigation
  dashboard: 'grid-1x2', person_add: 'person-plus', assignment: 'clipboard-check', electric_rickshaw: 'truck-front',
  pedal_bike: 'bicycle', groups: 'people', payments: 'cash-stack', warning: 'exclamation-triangle', bar_chart: 'bar-chart-line',
  history: 'clock-history', settings: 'gear', menu: 'list', logout: 'box-arrow-right', search: 'search', person: 'person',
  // actions
  add: 'plus-lg', edit: 'pencil-square', save: 'floppy', delete: 'trash3', close: 'x-lg', check: 'check-lg', done_all: 'check2-all',
  download: 'download', print: 'printer', send: 'send', mail: 'envelope', sync: 'arrow-repeat', sync_problem: 'exclamation-octagon',
  sync_disabled: 'pause-circle', restart_alt: 'arrow-counterclockwise', draw: 'pen', visibility: 'eye', block: 'slash-circle',
  lock: 'lock', lock_open: 'unlock', playlist_add: 'list-check', swap_horiz: 'arrow-left-right', casino: 'dice-5',
  arrow_back: 'arrow-left', arrow_forward: 'arrow-right', chevron_left: 'chevron-left', chevron_right: 'chevron-right',
  // métier
  shopping_cart: 'cart-check', directions_walk: 'person-walking', point_of_sale: 'receipt', account_balance_wallet: 'wallet2',
  receipt_long: 'receipt-cutoff', receipt: 'receipt', paid: 'cash-coin', hourglass_top: 'hourglass-split', schedule: 'clock',
  description: 'file-earmark-text', badge: 'person-vcard', lan: 'diagram-3', report: 'exclamation-octagon',
  // états
  check_circle: 'check-circle-fill', task_alt: 'check2-circle', cancel: 'x-circle-fill', error: 'exclamation-circle-fill',
  info: 'info-circle', verified: 'patch-check', inbox: 'inbox', search_off: 'search', explore_off: 'signpost-split', circle: 'circle',
  notifications: 'bell', visibility_off: 'eye-slash',
  // thème
  light_mode: 'sun', dark_mode: 'moon-stars', contrast: 'circle-half',
}

export const iconClass = name => `bi bi-${ICONS[name] || name.replace(/_/g, '-')}`
