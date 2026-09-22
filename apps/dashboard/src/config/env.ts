import 'server-only';
import { z } from 'zod';

const EnvSchema = z.object({
  /** Banco de telemetria escrito pelos apps host. A dashboard so le. */
  TELEMETRY_DB_PATH: z.string().min(1).default('.harness/telemetry.db'),
});

/**
 * Validado na primeira leitura, no servidor.
 *
 * Falhar aqui, no boot, e melhor que falhar por caminho inexistente no meio de
 * uma query — o erro diz o que falta em vez de vazar um erro cru do SQLite.
 */
export const env = EnvSchema.parse(process.env);
