import 'react'

// Invoker for popover="hint" tips; React passes unknown lowercase attributes through as they are written.
declare module 'react' {
  interface ButtonHTMLAttributes<T> {
    interestfor?: string
  }
}
