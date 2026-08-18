import type { Dispatch, SetStateAction } from 'react';
import { useT } from '../i18n';
import type { AppConfig } from '../types';

interface Props {
  cfg: AppConfig;
  setCfg?: Dispatch<SetStateAction<AppConfig>>;
}

export function PrivacySection({ cfg }: Props): JSX.Element {
  const t = useT();
  return (
    <section className="settings-section">
      <div className="settings-subsection">
        <div className="section-head">
          <div>
            <h4>{t('settings.privacyInstallationId')}</h4>
            <p className="hint">遥测功能已由此 Open Design fork 完整关闭，不会采集或上传使用数据、内容、错误追踪或运行 trace。</p>
          </div>
        </div>
        <div className="settings-field">
          <input
            type="text"
            readOnly
            value="Telemetry disabled"
            aria-label={t('settings.privacyInstallationId')}
          />
        </div>
      </div>
    </section>
  );
}

interface ToggleRowProps {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

// Reuses .toggle-row (label + hint + iOS-style switch) — same control
// NewProjectPanel uses for "speaker notes" / "animations" toggles, so the
// Privacy panel reads as native to the rest of the app.
function ToggleRow({ label, hint, checked, onChange }: ToggleRowProps): JSX.Element {
  return (
    <button
      type="button"
      className={`toggle-row${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      <div className="toggle-row-text">
        <span className="toggle-row-label">{label}</span>
        <span className="toggle-row-hint">{hint}</span>
      </div>
      <span className="toggle-row-switch" aria-hidden />
    </button>
  );
}

interface ConsentProps {
  onShare: () => void;
  onDecline: () => void;
  sharingEnabled?: boolean;
}

function ConsentCard({ onShare, onDecline, sharingEnabled }: ConsentProps): JSX.Element {
  const t = useT();
  return (
    <div className="settings-subsection">
      <div className="section-head">
        <div>
          <h4 className="privacy-consent-title">{t('settings.privacyConsentKicker')}</h4>
        </div>
      </div>

      <div className="privacy-consent-card">
        <p className="privacy-consent-lead">{t('settings.privacyConsentLead')}</p>

        <dl className="settings-privacy-disclosure">
          <div>
            <dt>{t('settings.privacyMetrics')}</dt>
            <dd>{t('settings.privacyMetricsHint')}</dd>
          </div>
          <div>
            <dt>{t('settings.privacyContent')}</dt>
            <dd>{t('settings.privacyContentHint')}</dd>
          </div>
        </dl>

        <p className="hint">{t('settings.privacyConsentFooter')}</p>

        <div
          className="privacy-consent-actions"
          role="group"
          aria-label={t('settings.privacyConsentKicker')}
        >
        <button
          type="button"
          className={`privacy-consent-action${sharingEnabled === false ? ' is-active' : ''}`}
          aria-pressed={sharingEnabled === false}
          onClick={onDecline}
        >
          {t('settings.privacyConsentDecline')}
        </button>
        <button
          type="button"
          className={`privacy-consent-action privacy-consent-action--primary${sharingEnabled === true ? ' is-active' : ''}`}
          aria-pressed={sharingEnabled === true}
          onClick={onShare}
        >
          {t('settings.privacyConsentShare')}
        </button>
        </div>
      </div>
    </div>
  );
}
