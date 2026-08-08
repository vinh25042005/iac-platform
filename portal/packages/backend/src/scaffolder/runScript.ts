import {
  createBackendModule,
} from '@backstage/backend-plugin-api';
import {
  scaffolderActionsExtensionPoint,
  createTemplateAction,
} from '@backstage/plugin-scaffolder-node';
import { spawn } from 'child_process';

// =============================================================================
// Custom scaffolder action: run:script
// Chạy 1 script shell trong workspace (dùng cho iac-platform new-project.sh).
//   input:
//     path     - thư mục con trong workspace nơi chạy (mặc định workspace root)
//     command  - lệnh/script để chạy (VD: ./scripts/new-project.sh)
//     args     - mảng tham số truyền vào
//     env      - object biến môi trường (KHÔNG nhúng vào command string → tránh
//                lỗi mất quotes như ENVS="dev stg prd" bị tách thành lệnh riêng)
//     useShell - true nếu cần shell (&&, ||, redirect...). Mặc định false (an toàn)
// =============================================================================
const runScriptAction = createTemplateAction<
  {
    path?: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    useShell?: boolean;
  },
  {}
>({
  id: 'run:script',
  description:
    'Run a shell command inside the scaffolder workspace (custom action for iac-platform)',
  schema: {
    input: {
      type: 'object',
      required: ['command'],
      properties: {
        path: {
          title: 'Working directory (relative to workspace)',
          type: 'string',
        },
        command: {
          title: 'Command / script to run',
          type: 'string',
        },
        args: {
          title: 'Arguments',
          type: 'array',
          items: { type: 'string' },
        },
        env: {
          title: 'Environment variables',
          type: 'object',
          additionalProperties: { type: 'string' },
        },
        useShell: {
          title: 'Run through shell (&&, ||, redirect)',
          type: 'boolean',
        },
      },
    },
  },
  async handler(ctx) {
    const { command, args = [], path = '.', env = {}, useShell = false } =
      ctx.input;
    const cwd = `${ctx.workspacePath}${path.startsWith('/') ? path : `/${path}`}`;

    ctx.logger.info(
      `[run:script] $ ${command} ${args.join(' ')}  (cwd=...${path})`,
    );

    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        shell: useShell,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderrBuf = '';
      child.stdout?.on('data', d => {
        const s = d.toString();
        ctx.logger.info(s.trimEnd());
      });
      child.stderr?.on('data', d => {
        const s = d.toString();
        stderrBuf += s;
        ctx.logger.warn(s.trimEnd());
      });
      child.on('error', e => {
        reject(new Error(`[run:script] spawn error: ${e.message}`));
      });
      child.on('close', code => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `[run:script] exit code ${code}\n${stderrBuf.trim()}`,
            ),
          );
        }
      });
    });
  },
});

// Module đăng ký action vào scaffolder
export const scaffolderRunScriptModule = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'run-script-action',
  register(env) {
    env.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
      },
      async init({ scaffolder }) {
        scaffolder.addActions(runScriptAction);
      },
    });
  },
});
