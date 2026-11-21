/**
 * One plugin panel as a page of its own, reached from the sidebar
 * (docs/ADMIN_I18N_AND_UI.md, D8 and U3).
 *
 * Inquiries are what a trade site's operator opens every day; at the foot
 * of the Plugins page, under the plugin's settings and secrets, they were a
 * long scroll away. The panel itself is the same component the Plugins page
 * used: only where it is shown changed.
 */

import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import { Link, useParams } from 'react-router';
import { EmptyState } from '../components/empty-state.js';
import { Page, PageHeader } from '../components/page.js';
import { PluginPanelView } from '../components/plugin-panel.js';
import { useReportError } from '../notice.js';
import { pluginsQuery } from '../queries.js';

/** The panel named by the address, with its plugin's name and switch. */
export function PluginPanelPage(): JSX.Element {
  const { t } = useLingui();
  const { pluginId = '', panelId = '' } = useParams();
  const listed = useQuery(pluginsQuery);
  useReportError(listed.error, t`Could not load plugins.`);
  const plugin = listed.data?.plugins.find((entry) => entry.id === pluginId);
  // A panel attached to a content kind lives in that kind's editor only.
  const panel = plugin?.panels.find(
    (entry) => entry.id === panelId && entry.attachTo === undefined,
  );

  if (listed.isPending) {
    return (
      <Page width="list">
        <p className="text-sm text-muted-foreground">
          <Trans>Loading…</Trans>
        </p>
      </Page>
    );
  }
  if (plugin === undefined || panel === undefined) {
    return (
      <Page width="list">
        <PageHeader title={t`Not found`} />
        <EmptyState>
          <Trans>No plugin in this build has a list at this address.</Trans>
        </EmptyState>
      </Page>
    );
  }

  const pluginName = plugin.name;
  return (
    <Page width="list">
      <PageHeader
        title={panel.label}
        lede={
          <>
            <Trans>From the {pluginName} plugin.</Trans>{' '}
            <Link
              to={`/plugins#plugin-${plugin.id}`}
              className="underline underline-offset-4 hover:text-foreground"
            >
              <Trans>Its settings</Trans>
            </Link>
          </>
        }
      />
      {plugin.enabled ? null : (
        // Switched off, it stops adding rows; what it stored stays readable.
        <p className="text-sm text-muted-foreground" role="note">
          <Trans>
            The {pluginName} plugin is off, so nothing new arrives here. What it
            already stored is listed below.
          </Trans>
        </p>
      )}
      <PluginPanelView
        key={`${plugin.id}/${panel.id}`}
        pluginId={plugin.id}
        panel={panel}
        standalone
      />
    </Page>
  );
}
