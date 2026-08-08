import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import projectsPlugin from '@internal/backstage-plugin-projects';
import { navModule } from './modules/nav';

export default createApp({
  features: [catalogPlugin, projectsPlugin, navModule],
});
