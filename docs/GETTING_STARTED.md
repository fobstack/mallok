# Create your first Mallok site

[简体中文](zh-CN/GETTING_STARTED.md) · [Documentation](README.md)

This guide targets the published **0.1.0-rc.6** candidate. See the
[release status](RELEASE_STATUS.md) for outstanding acceptance checks.
The [public demo](https://demo.mallok.dev/) is read-only; create your own
site to use the admin and collect inquiries.

## 1. Generate and check a local project

Install Node.js 22 or newer, including npm. You also need a Cloudflare
account with access to Workers, D1 and R2 for deployment. This guide uses
npm for the generated site; pnpm is for developing the Mallok repository.

```sh
npx mallok create my-site --no-deploy
cd my-site
npx mallok --version
```

This installs dependencies, builds the project and checks the deployment
configuration locally. It does not create cloud resources. Keep the generated
`package-lock.json`: it records the dependencies used by your site.

## 2. Sign in and deploy

Run these commands **inside `my-site`**, using its installed Wrangler:

```sh
npx wrangler login
npx wrangler whoami
npx mallok create . --slug my-site
```

Check that the account is the one you intend to use. Choose a distinct slug
for each site. Creation provisions a Worker, D1 database and R2 bucket in
that account. Existing resources that the project does not own are refused.

To use a custom domain from the first deployment, replace the final command
with the following, substituting a hostname you control in Cloudflare:

```sh
npx mallok create . --slug my-site --domain site.example.com
```

If creation stops, retain the project and `.mallok/create-state.json`, fix
the reported problem, and repeat the same command with the same slug and
domain. Do not delete the ledger or use `destroy` as a retry mechanism.
A completed create run is idempotent; it does not redeploy code changes.

The CLI prints a one-time **setup key**. Keep it privately until setup is
finished. Cloudflare login authorizes infrastructure operations; this key
claims your new Mallok admin. Neither is a Mallok content API token.

## 3. Finish setup

Open the setup URL printed by the CLI (`/_mallok/setup` on your site).

1. Create the administrator with a password of at least 12 characters and
   the setup key.
2. Set the site name. Use `en` as the main language for an English-first site;
   add `zh` or other languages as needed. Secondary languages have URL prefixes.
3. Choose example content or skip it. Sample businesses, products and claims
   are placeholders: replace them before presenting the site as your business.
4. Review the domain step and finish setup.

The admin is at `/_mallok/app`. If you started on a `workers.dev` URL, follow
the setup screen's custom-domain instructions before evaluating edge caching.
In the absence of purge credentials, setup uses a short cache lifetime;
allow that lifetime to expire when checking edits on the public site.

## 4. Publish your first product

In the admin, open **Content** and edit a starter product, or create an item
of a content kind supported by your theme. Enter its title, slug, language,
Markdown body and the theme's product fields. Use **Media** or the editor's
media picker for your own images, and replace example specifications.

Use **Save draft** while editing, then **Publish**. Open the public URL in
a signed-out browser and check the title, image, body and language links.
Edit and publish again, then verify the updated page after cache invalidation
or expiry. Content publishing does not require a code rebuild.

Use **Settings** for site details and appearance. Changes to theme code or
installed plugin code require a build and deployment; content edits do not.

## 5. Configure inquiries

The static public demo cannot accept inquiries. On your deployed Worker,
open **Plugins → Inquiry** and configure:

| Setting | Value |
| --- | --- |
| Recipient email | An inbox you control and will check |
| From address | A sender verified in your Resend account |
| Send buyers an automatic confirmation | Enable only when ready to send buyer emails |
| Turnstile site key | The widget's public key for your site's hostname |
| Thank-you page path | A published page on your site, such as `/thank-you` |
| Resend API key | Save in the plugin's secret field |
| Turnstile secret key | Save the matching widget secret in the plugin's secret field |

Save the settings and secrets, and enable the plugin. These plugin keys are
stored through Mallok's secret configuration; do not paste them into content,
source files or the public site-key field. A content page containing
`[[inquiry]]` renders the form when the plugin is enabled.

Submit a clearly labelled test using email addresses you control. Verify the
thank-you page, the stored inquiry in the admin, and actual receipt in the
recipient inbox. If automatic confirmation is enabled, also check the buyer
inbox. A successful form redirect or API-key check alone does not prove mail
delivery. Real Turnstile and Resend delivery acceptance is still pending for
this release; see [release status](RELEASE_STATUS.md).

## 6. Keep a content export

Create a scoped API token in the admin's account page, with export permission.
Provide it privately through `MALLOK_TOKEN`, then run:

```sh
npx mallok export ./site-backup --url https://site.example.com
```

Replace the origin with your actual site. Keep the export and your project
configuration separately; a content export is not a backup of every cloud
resource or secret. See [CLI reference](CLI.md) for token scopes, import,
upgrade and recovery commands.
