"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { actionConfigSchema } from "@/lib/followup/graph-schema";
import { MODOS_DA_ACAO, opcoes, type ModoDaAcao } from "@/lib/followup/vocabulario";
import { useMessageTemplates } from "@/hooks/inbox/useMessageTemplates";
import { useT } from "@/hooks/i18n/useT";

import type { ConfigOf } from "./shared";

/**
 * O seletor de modelo, no lugar dos dois `<Input>` que pediam um UUID colado à
 * mão. Trata os três estados em vez de fingir que a lista sempre chega:
 * carregando, vazia e erro — porque um seletor vazio sem explicação é o mesmo
 * beco sem saída que o campo de UUID era, só que mais bonito.
 */
function SeletorDeModelo({
  id,
  valor,
  onChange,
  permiteVazio,
}: {
  id: string;
  valor: string;
  onChange: (templateId: string) => void;
  permiteVazio: boolean;
}) {
  const t = useT();
  const { data: modelos, isLoading, isError } = useMessageTemplates();

  if (isLoading) return <p className="text-xs text-text-muted">{t("Carregando seus modelos…")}</p>;
  if (isError) {
    return (
      <p className="text-xs text-error-fg">
        {t("Não consegui carregar seus modelos de mensagem. Recarregue a página.")}
      </p>
    );
  }
  if (!modelos?.length) {
    return (
      <p className="text-xs text-text-muted">
        {t("Você ainda não tem modelos de mensagem. Crie um em Ajustes → Modelos e ele aparece aqui.")}
      </p>
    );
  }

  const SEM_MODELO = "__nenhum__";
  return (
    <Select
      value={valor === "" ? SEM_MODELO : valor}
      onValueChange={(v) => onChange(v === SEM_MODELO ? "" : v)}
    >
      <SelectTrigger id={id}>
        <SelectValue placeholder={t("Escolha um modelo")} />
      </SelectTrigger>
      <SelectContent>
        {permiteVazio && <SelectItem value={SEM_MODELO}>{t("Nenhum")}</SelectItem>}
        {modelos.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type BotaoLocal = { id: string; text: string };

export function ActionForm({
  config,
  onChange,
}: {
  config: ConfigOf<"action">;
  onChange: (c: ConfigOf<"action">) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState(config.mode);
  const [body, setBody] = useState(
    config.mode === "text" || config.mode === "choices" ? config.body : "",
  );
  const [promptHint, setPromptHint] = useState(config.mode === "ai_message" ? config.prompt_hint : "");
  const [fallbackTemplateId, setFallbackTemplateId] = useState(
    config.mode === "ai_message" ? (config.fallback_template_id ?? "") : "",
  );
  const [templateId, setTemplateId] = useState(config.mode === "template" ? config.template_id : "");
  const [queueLabel, setQueueLabel] = useState(config.mode === "handoff" ? config.queue_label : "");
  const [inactivityMessage, setInactivityMessage] = useState(
    config.mode === "handoff" ? (config.inactivity_message ?? "") : "",
  );
  const [header, setHeader] = useState(config.mode === "choices" ? (config.header ?? "") : "");
  const [footer, setFooter] = useState(config.mode === "choices" ? (config.footer ?? "") : "");
  const [buttons, setButtons] = useState<BotaoLocal[]>(
    config.mode === "choices"
      ? config.buttons
      : [
          { id: "opcao_1", text: "Opção 1" },
          { id: "opcao_2", text: "Opção 2" },
        ],
  );
  const [error, setError] = useState<string | null>(null);

  const commit = (next: {
    mode: ModoDaAcao;
    body: string;
    promptHint: string;
    fallbackTemplateId: string;
    templateId: string;
    queueLabel: string;
    inactivityMessage: string;
    header: string;
    footer: string;
    buttons: BotaoLocal[];
  }) => {
    const candidate =
      next.mode === "text"
        ? { mode: "text" as const, body: next.body }
        : next.mode === "ai_message"
          ? {
              mode: "ai_message" as const,
              prompt_hint: next.promptHint,
              ...(next.fallbackTemplateId.trim() ? { fallback_template_id: next.fallbackTemplateId } : {}),
            }
          : next.mode === "template"
            ? { mode: "template" as const, template_id: next.templateId }
            : next.mode === "choices"
              ? {
                  mode: "choices" as const,
                  body: next.body,
                  ...(next.header.trim() ? { header: next.header.trim() } : {}),
                  ...(next.footer.trim() ? { footer: next.footer.trim() } : {}),
                  buttons: next.buttons,
                }
              : {
                  mode: "handoff" as const,
                  queue_label: next.queueLabel,
                  ...(next.inactivityMessage.trim()
                    ? { inactivity_message: next.inactivityMessage.trim() }
                    : {}),
                };
    const parsed = actionConfigSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("Configuração inválida."));
      return;
    }
    setError(null);
    onChange(parsed.data);
  };

  const fields = {
    body,
    promptHint,
    fallbackTemplateId,
    templateId,
    queueLabel,
    inactivityMessage,
    header,
    footer,
    buttons,
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="action-mode">{t("Como escrever a mensagem")}</Label>
        <Select
          value={mode}
          onValueChange={(v) => {
            const next = v as ModoDaAcao;
            setMode(next);
            commit({ mode: next, ...fields });
          }}
        >
          <SelectTrigger id="action-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {opcoes(MODOS_DA_ACAO).map(({ valor, rotulo }) => (
              <SelectItem key={valor} value={valor}>
                {t(rotulo)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {mode === "text" ? (
        <div className="space-y-2">
          <Label htmlFor="action-body">Texto enviado ao contato</Label>
          <Textarea
            id="action-body"
            maxLength={4000}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              commit({ mode, ...fields, body: e.target.value });
            }}
          />
          <p className="text-xs text-text-muted">
            {t("Sai exatamente assim, sem IA. Use")} {t("{{nome}}")} / {t("{{primeiro_nome}}")}.{" "}
            {t("No laço,")} {t("{{volta}}")} {t("e")} {t("{{voltas}}")}.
          </p>
        </div>
      ) : mode === "ai_message" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="action-prompt-hint">{t("Instrução para a IA")}</Label>
            <Textarea
              id="action-prompt-hint"
              maxLength={1000}
              value={promptHint}
              onChange={(e) => {
                setPromptHint(e.target.value);
                commit({ mode, ...fields, promptHint: e.target.value });
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="action-fallback">{t("Se a IA não conseguir escrever, mandar este modelo")}</Label>
            <SeletorDeModelo
              id="action-fallback"
              valor={fallbackTemplateId}
              permiteVazio
              onChange={(v) => {
                setFallbackTemplateId(v);
                commit({ mode, ...fields, fallbackTemplateId: v });
              }}
            />
          </div>
        </>
      ) : mode === "template" ? (
        <div className="space-y-2">
          <Label htmlFor="action-template-id">{t("Modelo de mensagem")}</Label>
          <SeletorDeModelo
            id="action-template-id"
            valor={templateId}
            permiteVazio={false}
            onChange={(v) => {
              setTemplateId(v);
              commit({ mode, ...fields, templateId: v });
            }}
          />
        </div>
      ) : mode === "choices" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="action-choices-body">{t("Texto acima dos botões")}</Label>
            <Textarea
              id="action-choices-body"
              maxLength={4000}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                commit({ mode, ...fields, body: e.target.value });
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="action-choices-header">{t("Cabeçalho (opcional)")}</Label>
            <Input
              id="action-choices-header"
              maxLength={60}
              value={header}
              onChange={(e) => {
                setHeader(e.target.value);
                commit({ mode, ...fields, header: e.target.value });
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("Botões (máx. 3)")}</Label>
            {buttons.map((b, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  placeholder="id"
                  value={b.id}
                  onChange={(e) => {
                    const next = buttons.map((x, j) => (j === i ? { ...x, id: e.target.value } : x));
                    setButtons(next);
                    commit({ mode, ...fields, buttons: next });
                  }}
                />
                <Input
                  placeholder={t("Texto")}
                  maxLength={20}
                  value={b.text}
                  onChange={(e) => {
                    const next = buttons.map((x, j) => (j === i ? { ...x, text: e.target.value } : x));
                    setButtons(next);
                    commit({ mode, ...fields, buttons: next });
                  }}
                />
              </div>
            ))}
            {buttons.length < 3 && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  const next = [...buttons, { id: `opcao_${buttons.length + 1}`, text: `Opção ${buttons.length + 1}` }];
                  setButtons(next);
                  commit({ mode, ...fields, buttons: next });
                }}
              >
                {t("Adicionar botão")}
              </Button>
            )}
            <p className="text-xs text-text-muted">
              {t("Se o WhatsApp recusar os botões, o sistema manda o mesmo texto numerado (1) 2) 3)).")}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="action-choices-footer">{t("Rodapé (opcional)")}</Label>
            <Input
              id="action-choices-footer"
              maxLength={60}
              value={footer}
              onChange={(e) => {
                setFooter(e.target.value);
                commit({ mode, ...fields, footer: e.target.value });
              }}
            />
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="action-queue-label">{t("Rótulo na fila de atendentes")}</Label>
            <Input
              id="action-queue-label"
              maxLength={80}
              value={queueLabel}
              onChange={(e) => {
                setQueueLabel(e.target.value);
                commit({ mode, ...fields, queueLabel: e.target.value });
              }}
            />
            <p className="text-xs text-text-muted">
              {t("A conversa vai para a fila humana com este motivo visível.")}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="action-inactivity-msg">{t("Se ninguém falar em 24h (opcional)")}</Label>
            <Textarea
              id="action-inactivity-msg"
              maxLength={1000}
              value={inactivityMessage}
              onChange={(e) => {
                setInactivityMessage(e.target.value);
                commit({ mode, ...fields, inactivityMessage: e.target.value });
              }}
            />
          </div>
        </div>
      )}
      {error && <p className="text-xs text-error-fg">{error}</p>}
    </div>
  );
}
