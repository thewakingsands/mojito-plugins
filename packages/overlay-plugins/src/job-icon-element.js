import { jobId, loadJobIcon } from './job-icons.js'

const template = document.createElement('template')
template.innerHTML = `<style>:host{display:inline-block;aspect-ratio:1;text-align:center;vertical-align:middle}span{display:block;width:100%;height:100%}img{width:100%;height:100%;object-fit:contain;display:block}</style><span></span>`
const visibility = new IntersectionObserver((entries) => {
  for (const { target, isIntersecting } of entries) if (isIntersecting) target.load()
})

class JobIcon extends HTMLElement {
  static observedAttributes = ['job']

  constructor() {
    super()
    this.attachShadow({ mode: 'open' }).append(template.content.cloneNode(true))
    this.content = this.shadowRoot.querySelector('span')
  }

  connectedCallback() {
    if (!this.content.querySelector('img')) visibility.observe(this)
  }

  disconnectedCallback() {
    visibility.unobserve(this)
  }

  attributeChangedCallback(_name, previous, job) {
    if (previous === job) return
    this.content.textContent = (job || '').toUpperCase()
    if (this.isConnected) {
      visibility.unobserve(this)
      visibility.observe(this)
    }
  }

  async load() {
    const job = this.getAttribute('job') || ''
    const url = await loadJobIcon(jobId(job))
    if (!url || !this.isConnected || this.getAttribute('job') !== job) return
    const img = new Image()
    img.alt = job.toUpperCase()
    img.onload = () => {
      if (this.isConnected && this.getAttribute('job') === job) {
        this.content.replaceChildren(img)
        visibility.unobserve(this)
      }
    }
    img.src = url
  }
}

customElements.define('mojito-job-icon', JobIcon)
