/**
 * `AjaxFetchAdapter` - deprecated.
 *
 * Breeze 3 does not need an ajax adapter. Requests go through `config.fetch`, which you set
 * with `configureBreeze({ fetch })` and which defaults to `globalThis.fetch`.
 *
 * This entry point is kept so that 2.x startup code - `AjaxFetchAdapter.register()`,
 * `configureBreeze({ ajax: AjaxFetchAdapter })`, `config.initializeAdapterInstance('ajax',
 * 'fetch')` - and code that uses the adapter's `defaultSettings` or `requestInterceptor`
 * keeps working. The implementation now lives in the core, shared with the default path.
 */
export { AjaxFetchAdapter } from './http';
