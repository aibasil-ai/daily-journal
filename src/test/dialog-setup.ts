const returnFocusTargets = new WeakMap<HTMLDialogElement, HTMLElement>()

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    const activeElement = this.ownerDocument.activeElement
    if (activeElement instanceof HTMLElement) returnFocusTargets.set(this, activeElement)
    this.setAttribute('open', '')
    this.tabIndex = -1
    this.focus()
  }
}

if (!HTMLDialogElement.prototype.close) {
  HTMLDialogElement.prototype.close = function close() {
    if (!this.open) return
    this.removeAttribute('open')
    const returnFocusTarget = returnFocusTargets.get(this)
    returnFocusTargets.delete(this)
    if (returnFocusTarget?.isConnected && !returnFocusTarget.matches(':disabled')) returnFocusTarget.focus()
    this.dispatchEvent(new Event('close'))
  }
}
