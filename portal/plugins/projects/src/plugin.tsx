import {
  createFrontendPlugin,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';

import { rootRouteRef } from './routes';

export const page = PageBlueprint.make({
  params: {
    path: '/projects',
    routeRef: rootRouteRef,
    loader: () =>
      import('./components/ProjectsListPage/ProjectsListPage').then(m => (
        <m.ProjectsListPage />
      )),
  },
});

export const projectsPlugin = createFrontendPlugin({
  pluginId: 'projects',
  extensions: [page],
  routes: {
    root: rootRouteRef,
  }
});
