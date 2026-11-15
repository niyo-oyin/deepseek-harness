/** Locale-owned approval text; reviewer reasons remain verbatim in every language. */

/** English approval messages. */
export const en = {
  denied: 'Auto review denied this call.',
  deniedWithReason: (reason: string): string => `Auto review denied this call: ${reason}`,
}

/** Chinese approval messages. */
export const zh = {
  denied: 'Auto review 拒绝了此调用。',
  deniedWithReason: (reason: string): string => `Auto review 拒绝了此调用：${reason}`,
} satisfies typeof en

/** Japanese approval messages. */
export const ja = {
  denied: '自動認可レビューがこの呼び出しを拒否しました。',
  deniedWithReason: (reason: string): string => `自動認可レビューがこの呼び出しを拒否しました：${reason}`,
} satisfies typeof en

/** Spanish dictionary, checked against the English keys. */
export const es = {
  denied: 'Auto review ha denegado esta llamada.',
  deniedWithReason: (reason: string): string => `Auto review ha denegado esta llamada: ${reason}`,
} satisfies typeof en

/** French dictionary, checked against the English keys. */
export const fr = {
  denied: 'Auto review a refusé cet appel.',
  deniedWithReason: (reason: string): string => `Auto review a refusé cet appel : ${reason}`,
} satisfies typeof en

/** German dictionary, checked against the English keys. */
export const de = {
  denied: 'Auto review hat diesen Aufruf abgelehnt.',
  deniedWithReason: (reason: string): string => `Auto review hat diesen Aufruf abgelehnt: ${reason}`,
} satisfies typeof en

/** Russian dictionary, checked against the English keys. */
export const ru = {
  denied: 'Auto review отклонила этот вызов.',
  deniedWithReason: (reason: string): string => `Auto review отклонила этот вызов: ${reason}`,
} satisfies typeof en

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  denied: 'Auto review negou esta chamada.',
  deniedWithReason: (reason: string): string => `Auto review negou esta chamada: ${reason}`,
} satisfies typeof en

/**
 * Build all display translations without translating the reviewer's raw reason.
 * @param reason - optional reviewer explanation.
 * @returns text for the Client's localized-text resolver.
 */
export function deniedDisplayReason(reason?: string): Record<'en' | 'zh' | 'ja' | 'es' | 'fr' | 'de' | 'ru' | 'pt', string> {
  return reason === undefined
    ? { en: en.denied, zh: zh.denied, ja: ja.denied, es: es.denied, fr: fr.denied, de: de.denied, ru: ru.denied, pt: pt.denied }
    : {
      en: en.deniedWithReason(reason),
      zh: zh.deniedWithReason(reason),
      ja: ja.deniedWithReason(reason),
      es: es.deniedWithReason(reason),
      fr: fr.deniedWithReason(reason),
      de: de.deniedWithReason(reason),
      ru: ru.deniedWithReason(reason),
      pt: pt.deniedWithReason(reason),
    }
}

/**
 * Help under the reviewer model setting, as schema descriptions by locale.
 * Each says that Auto costs one extra request to this model per tool call, and
 * that reviews send the session's action history to this model's provider.
 */
export const reviewerDescriptions: Record<'en' | 'zh' | 'ja' | 'es' | 'fr' | 'de' | 'ru' | 'pt', { $description: string }> = {
  en: { $description: 'The model that reviews each tool call in Auto. Every tool call costs one extra request to this model. Each review sends the session\'s action history — tool calls with their arguments, and the prompts that started delegated work — to this model\'s provider, so a model from another provider receives that content too. Same as the session\'s model when not set.' },
  zh: { $description: '在 Auto 模式下审查每次工具调用的模型。每次工具调用都会额外向此模型发送一次请求。每次审查都会把会话的操作记录（工具调用及其参数，以及发起委托任务的提示）发送给此模型的提供商；选择其他提供商的模型时，这些内容也会发送到那里。未设置时与会话的模型相同。' },
  ja: { $description: 'Auto モードで各ツール呼び出しを審査するモデルです。ツール呼び出しのたびに、このモデルへのリクエストが 1 回増えます。審査のたびに、セッションの操作履歴（引数を含むツール呼び出しと、委任した作業を始めたプロンプト）をこのモデルのプロバイダーへ送ります。別のプロバイダーのモデルを選ぶと、その内容はそのプロバイダーにも送られます。未設定のときはセッションのモデルと同じです。' },
  es: { $description: 'El modelo que revisa cada llamada a herramienta en Auto. Cada llamada a herramienta cuesta una solicitud adicional a este modelo. Cada revisión envía el historial de acciones de la sesión —las llamadas a herramientas con sus argumentos y las instrucciones que iniciaron trabajo delegado— al proveedor de este modelo, así que un modelo de otro proveedor también recibe ese contenido. Sin configurar, es el mismo modelo que la sesión.' },
  fr: { $description: 'Le modèle qui examine chaque appel d’outil en Auto. Chaque appel d’outil coûte une requête supplémentaire à ce modèle. Chaque examen envoie l’historique des actions de la session — les appels d’outils avec leurs arguments et les instructions qui ont lancé un travail délégué — au fournisseur de ce modèle ; un modèle d’un autre fournisseur reçoit donc aussi ce contenu. Sans réglage, c’est le modèle de la session.' },
  de: { $description: 'Das Modell, das in Auto jeden Werkzeugaufruf prüft. Jeder Werkzeugaufruf kostet eine zusätzliche Anfrage an dieses Modell. Jede Prüfung sendet den Aktionsverlauf der Sitzung — Werkzeugaufrufe mit ihren Argumenten und die Anweisungen, die delegierte Arbeit gestartet haben — an den Anbieter dieses Modells; ein Modell eines anderen Anbieters erhält diese Inhalte also ebenfalls. Ohne Einstellung ist es das Modell der Sitzung.' },
  ru: { $description: 'Модель, которая проверяет каждый вызов инструмента в режиме Auto. Каждый вызов инструмента стоит одного дополнительного запроса к этой модели. Каждая проверка отправляет историю действий сессии — вызовы инструментов с аргументами и запросы, с которых началась делегированная работа, — провайдеру этой модели, поэтому модель другого провайдера тоже получает это содержимое. Если не задано, используется модель сессии.' },
  pt: { $description: 'O modelo que revisa cada chamada de ferramenta no Auto. Cada chamada de ferramenta custa uma solicitação extra a este modelo. Cada revisão envia o histórico de ações da sessão — as chamadas de ferramentas com seus argumentos e os prompts que iniciaram trabalho delegado — ao provedor deste modelo; assim, um modelo de outro provedor também recebe esse conteúdo. Sem configuração, é o mesmo modelo da sessão.' },
}
