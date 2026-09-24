'use client';
import { useState, type FormEvent } from 'react';
import {
  Field,
  inputStyle,
  primaryButtonStyle,
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
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      // Sucesso e falha viram aviso no toast, disparado por quem executa o comando.
      await save({ action: 'saveSettings', definition: value, revision: state.settings!.revision });
    } catch {
      /* o toast ja mostrou o erro */
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex flex-1 flex-col"
      aria-label="Acesso às prévias"
    >
      <div className="space-y-5 px-6 py-6">
        <section className={panelStyle}>
          <p className="text-[13px] text-ink-muted">
            Traefik compartilha uma porta e dá um endereço a cada serviço. Para usar no celular,
            habilite a rede local e informe o IP do computador seguido de .sslip.io, ou um domínio
            configurado no seu DNS.
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Domínio das prévias">
              <input
                className={`${inputStyle} font-mono`}
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
        </section>
      </div>
      <div className="sticky bottom-0 mt-auto flex flex-wrap items-center gap-2 border-t border-rule bg-paper px-6 py-3">
        <button className={primaryButtonStyle} disabled={busy}>
          Salvar acesso
        </button>
      </div>
    </form>
  );
}
