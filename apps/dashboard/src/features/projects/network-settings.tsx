'use client';
import { useState, type FormEvent } from 'react';
import {
  Field,
  inputStyle,
  buttonStyle,
  panelStyle,
  type RunnerState,
  type RunnerCommandInput,
} from './shared';
export function NetworkSettings({
  state,
  save,
}: {
  state: RunnerState;
  save: (command: RunnerCommandInput) => Promise<void>;
}) {
  const [value, setValue] = useState(state.settings!);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await save({ action: 'saveSettings', definition: value, revision: state.settings!.revision });
      setMessage('Acesso atualizado. As próximas prévias usarão este endereço.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao salvar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(event) => void submit(event)}
      className={panelStyle}
      aria-label="Acesso às prévias"
    >
      <h2 className="font-medium">Acesso às prévias</h2>
      <p className="text-sm text-ink-muted">
        Traefik compartilha uma porta e dá um endereço a cada serviço. Para usar no celular,
        habilite a rede local e informe o IP do computador seguido de .sslip.io, ou um domínio
        configurado no seu DNS.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Domínio das prévias">
          <input
            className={inputStyle}
            required
            value={value.domain}
            onChange={(event) =>
              setValue((current) => ({ ...current, domain: event.target.value }))
            }
            placeholder="192.168.1.10.sslip.io"
          />
        </Field>
        <Field label="Porta do Traefik">
          <input
            className={inputStyle}
            type="number"
            min="1024"
            max="65535"
            value={value.port}
            onChange={(event) =>
              setValue((current) => ({ ...current, port: Number(event.target.value) }))
            }
          />
        </Field>
        <Field label="Disponibilidade">
          <select
            className={inputStyle}
            value={value.bindAddress}
            onChange={(event) =>
              setValue((current) => ({
                ...current,
                bindAddress: event.target.value as '127.0.0.1' | '0.0.0.0',
              }))
            }
          >
            <option value="127.0.0.1">Somente neste computador</option>
            <option value="0.0.0.0">Rede local, incluindo celular</option>
          </select>
        </Field>
      </div>
      <button className={buttonStyle} disabled={busy}>
        Salvar acesso
      </button>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </form>
  );
}
