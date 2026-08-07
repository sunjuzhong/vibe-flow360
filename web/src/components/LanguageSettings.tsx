import { Check, Languages, Settings, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n'
import { localeOptions } from '../i18n/locales'
import { useFocusTrap } from '../lib/useFocusTrap'

export default function LanguageSettings({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage } = useI18n()
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const dialogRef = useFocusTrap<HTMLDivElement>(open, close)

  return (
    <>
      <button
        type="button"
        className={`language-settings-trigger ${compact ? 'compact' : ''}`}
        aria-label="Settings"
        title="Settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Settings size={14} />
        {!compact && <span>Settings</span>}
      </button>
      {open && createPortal(
        <div className="language-settings-scrim" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false)
        }}>
          <div ref={dialogRef} className="language-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="language-settings-title" tabIndex={-1}>
            <header>
              <div><Settings size={16} /><strong id="language-settings-title">Settings</strong></div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close settings"><X size={16} /></button>
            </header>
            <section>
              <div className="language-settings-heading">
                <Languages size={17} />
                <div><strong>Language</strong><span>Choose the language used throughout the interface.</span></div>
              </div>
              <div className="language-settings-options" role="radiogroup" aria-label="Language">
                {localeOptions.map((option) => (
                  <button
                    key={option.code}
                    type="button"
                    role="radio"
                    aria-checked={language === option.code}
                    className={language === option.code ? 'active' : ''}
                    onClick={() => setLanguage(option.code)}
                  >
                    <span><strong>{option.nativeName}</strong><small>{option.displayName}</small></span>
                    {language === option.code && <Check size={16} />}
                  </button>
                ))}
              </div>
            </section>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
