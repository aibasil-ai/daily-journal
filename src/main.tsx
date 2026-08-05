import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { zhTW } from './i18n/zh-TW'
import './styles/global.css'

document.title = zhTW.appTitle

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
