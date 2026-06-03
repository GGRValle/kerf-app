import { createTranslator, type Translator } from '../../i18n/index.js';
import type { AppLocale, RoleRootContext } from './layout-props.js';
import { resolveRoleRootContext } from './roleRootAuth.js';

export interface LayoutRuntimeContext {
  readonly context: RoleRootContext;
  readonly translator: Translator;
  readonly t: Translator['t'];
}

export function createLayoutContext(params?: {
  username?: string;
  locale?: AppLocale;
  roleRoot?: import('./layout-props.js').RoleRoot;
}): LayoutRuntimeContext {
  const context = resolveRoleRootContext(params ?? {});
  const translator = createTranslator(context.locale);
  return { context, translator, t: translator.t.bind(translator) };
}
