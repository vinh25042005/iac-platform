import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { createRouter } from './router';
import { ProjectStoreService } from './services/ProjectStoreService';

/**
 * projectsBackendPlugin backend plugin
 *
 * @public
 */
export const projectsBackendPlugin = createBackendPlugin({
  pluginId: 'projects-backend',
  register(env) {
    env.registerInit({
      deps: {
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        logger: coreServices.logger,
        database: coreServices.database,
      },
      async init({ httpAuth, httpRouter, logger, database }) {
        const store = await ProjectStoreService.create({ logger, database });
        httpRouter.use(
          await createRouter({
            httpAuth,
            store,
          }),
        );
      },
    });
  },
});
