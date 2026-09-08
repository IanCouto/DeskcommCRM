"use client";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";

export type VoiceCallStatus = "starting" | "ringing" | "connected" | "ended";

export interface VoiceCallRow {
  id: string;
  contact_id: string | null;
  direction: "inbound" | "outbound";
  peer_phone: string;
  status: VoiceCallStatus;
  end_reason: string | null;
  started_at: string;
  answered_at: string | null;
}

interface VoiceCallsListResponse {
  data: VoiceCallRow[];
}

/** Chamada que a UI mostra AGORA: a mais recente ainda não `ended`. */
function ehRelevante(row: VoiceCallRow): boolean {
  return row.status !== "ended";
}

/**
 * Sessão de chamada de voz — spec docs/specs/18-spec-voice-calls-wacalls.md §5.
 *
 * Um hook só, porque as 3 telas (discador, recebendo, em andamento) são a
 * MESMA máquina de estado vista em 3 momentos, não 3 fluxos independentes.
 * `voice_calls` via Realtime é a fonte de verdade do STATUS (a ponte de
 * eventos do worker escreve lá); o WebRTC aqui é só o transporte de ÁUDIO —
 * os dois avançam em paralelo e podem divergir por um instante (ex.: WebRTC
 * conectado antes do Realtime confirmar `connected`), o que é esperado.
 */
export function useVoiceCallSession(remoteAudioRef: RefObject<HTMLAudioElement | null>) {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.orgId;

  const [call, setCall] = useState<VoiceCallRow | null>(null);
  const [muted, setMuted] = useState(false);
  const [connectingMedia, setConnectingMedia] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callRef = useRef<VoiceCallRow | null>(null);
  // Sincronizado em efeito, não durante o render: `callRef` só serve pra
  // closures de callback (accept/reject/hangUp) lerem o valor mais recente
  // sem entrar nas dependências — nunca é lido durante a renderização em si.
  useEffect(() => {
    callRef.current = call;
  }, [call]);

  const teardownMedia = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    setMuted(false);
    setConnectingMedia(false);
  }, [remoteAudioRef]);

  // Carrega a chamada em andamento no boot (refresh de página no meio de uma
  // ligação não pode perder o painel — é exatamente o tipo de "sumiu sem
  // explicação" que a doutrina de UI proíbe).
  useEffect(() => {
    if (!orgId) return;
    let cancelado = false;
    apiClient
      .get<VoiceCallsListResponse>("/api/v1/voice/calls/history?limit=5")
      .then((res) => {
        if (cancelado) return;
        const ativa = res.data.find(ehRelevante);
        if (ativa) setCall(ativa);
      })
      .catch(() => {
        // Falha aqui não é crítica: o Realtime pega o próximo evento. Uma
        // ligação já em andamento só não reaparece até a próxima mudança de
        // status — pior caso é um refresh perder o painel por alguns segundos.
      });
    return () => {
      cancelado = true;
    };
  }, [orgId]);

  const onRealtimeChange = useCallback((payload: unknown) => {
    const row = (payload as { new?: VoiceCallRow } | null)?.new;
    if (!row?.id) return;
    setCall((atual) => {
      // Só substitui se for a MESMA chamada (atualização) ou se não há
      // nenhuma em andamento (nova chamada chegando) — evita uma chamada de
      // outro atendente pisar no painel de quem já está em ligação.
      if (atual && atual.id !== row.id && ehRelevante(atual)) return atual;
      return ehRelevante(row) ? row : null;
    });
  }, []);

  useRealtimeChannel({
    name: "voice-calls",
    postgresChanges: {
      event: "*",
      table: "voice_calls",
      filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    },
    onChange: onRealtimeChange,
    enabled: !!orgId,
  });

  /** Abre a RTCPeerConnection, captura o microfone e troca o SDP com o backend. */
  const conectarMidia = useCallback(async (callId: string) => {
    setConnectingMedia(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      pc.ontrack = (ev) => {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = ev.streams[0] ?? null;
          void remoteAudioRef.current.play().catch(() => {});
        }
      };

      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);

      const res = await apiClient.post<{ data: { sdpAnswer: string } }>(
        `/api/v1/voice/calls/${callId}/webrtc`,
        { sdpOffer: offer.sdp },
      );
      await pc.setRemoteDescription({ type: "answer", sdp: res.data.sdpAnswer });
    } catch (err) {
      showApiError(err);
      teardownMedia();
    } finally {
      setConnectingMedia(false);
    }
  }, [teardownMedia, remoteAudioRef]);

  // Assim que o Realtime confirma `connected`, abre o áudio — não antes: o
  // WaCalls só aceita a troca de SDP depois que o `<call>` foi realmente
  // aceito do lado do WhatsApp (§4.1 da spec).
  useEffect(() => {
    if (call?.status === "connected" && !pcRef.current && !connectingMedia) {
      void conectarMidia(call.id);
    }
    if ((call?.status === "ended" || !call) && (pcRef.current || localStreamRef.current)) {
      teardownMedia();
    }
  }, [call, connectingMedia, conectarMidia, teardownMedia]);

  const startCall = useCallback(async (contactId: string) => {
    try {
      const res = await apiClient.post<{ data: VoiceCallRow }>("/api/v1/voice/calls", { contactId });
      setCall(res.data);
    } catch (err) {
      showApiError(err);
    }
  }, []);

  const acceptCall = useCallback(async () => {
    const atual = callRef.current;
    if (!atual) return;
    try {
      await apiClient.post(`/api/v1/voice/calls/${atual.id}/accept`, {});
    } catch (err) {
      showApiError(err);
    }
  }, []);

  const rejectCall = useCallback(async () => {
    const atual = callRef.current;
    if (!atual) return;
    try {
      await apiClient.post(`/api/v1/voice/calls/${atual.id}/reject`, {});
    } finally {
      setCall(null);
    }
  }, []);

  const hangUp = useCallback(async () => {
    const atual = callRef.current;
    if (!atual) return;
    try {
      await apiClient.delete(`/api/v1/voice/calls/${atual.id}`);
    } catch (err) {
      showApiError(err);
    } finally {
      setCall(null);
    }
  }, []);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  }, [muted]);

  useEffect(() => teardownMedia, [teardownMedia]);

  return {
    call,
    muted,
    connectingMedia,
    startCall,
    acceptCall,
    rejectCall,
    hangUp,
    toggleMute,
  };
}
