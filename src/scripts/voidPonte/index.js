// Ponte VOID <-> Mundo Zero (PLANO-030 §4.3): liga o núcleo (./ponte.js) ao
// jellyfin-web. Usa o MESMO caminho do botão "Quick Connect" da tela de login
// (controllers/session/login): Initiate -> Connect -> apiClient.quickConnect.
// Versão 2 (Etapa8/016): + o controle do player (./player.js), ligado ao
// playbackManager — só depois de o VOID mandar void:modo.

import { ServerConnections } from 'lib/jellyfin-apiclient';

import { history } from '../../RootAppRouter';
import { playbackManager } from '../../components/playback/playbackmanager';
import viewContainer from '../../components/viewContainer';
import { onServerChanged } from '../../utils/dashboard';
import Events from '../../utils/events.ts';
import { queryClient } from '../../utils/query/queryClient';
import { criarPonte } from './ponte';
import { criarPontePlayer, TRAVADOS_CONVIDADO } from './player';

// Telas de entrada: só delas a ponte leva à tela inicial depois do login.
const EM_LOGIN = /^\/(?:$|login|selectserver|forgotpassword|startup)/i;

function apiClient() {
    return ServerConnections.currentApiClient();
}

// Só acréscimo (D-T): classe no <body> e um aviso, só com void:modo convidado.
const CLASSE_CONVIDADO = 'void-convidado';
const CLASSE_TOCANDO = 'void-convidado-tocando';
const ESCONDER = [
    '.osdPositionSlider', '.osdPositionSliderContainer', '.btnPause', '.btnRewind', '.btnFastForward',
    '.btnPreviousTrack', '.btnNextTrack', '.btnPreviousChapter', '.btnNextChapter',
    '.osdTimeText', '.upNextContainer'
];

function marcar(convidado, nomeDona, tocando) {
    const corpo = document.body;
    if (!corpo) return;
    if (convidado && !document.getElementById('void-ponte-estilo')) {
        const estilo = document.createElement('style');
        estilo.id = 'void-ponte-estilo';
        estilo.textContent = ESCONDER.map(s => `body.${CLASSE_CONVIDADO} ${s}`).join(',\n')
            + ' { display: none !important; }\n'
            + '#void-ponte-aviso { display: none; position: fixed; top: 0.75em; left: 50%; transform: translateX(-50%);'
            + ' z-index: 999999; pointer-events: none; padding: 0.35em 0.9em; border-radius: 1em;'
            + ' background: rgba(0, 0, 0, 0.7); color: #fff; font-size: 0.9em; }\n'
            + `body.${CLASSE_CONVIDADO}.${CLASSE_TOCANDO} #void-ponte-aviso { display: block; }`;
        document.head.appendChild(estilo);
    }
    let aviso = document.getElementById('void-ponte-aviso');
    if (convidado && !aviso) {
        aviso = document.createElement('div');
        aviso.id = 'void-ponte-aviso';
        aviso.setAttribute('role', 'status');
        corpo.appendChild(aviso);
    }
    if (aviso) aviso.textContent = nomeDona ? `Quem controla é ${nomeDona}` : 'Quem controla é a dona da sala';
    corpo.classList.toggle(CLASSE_CONVIDADO, !!convidado);
    corpo.classList.toggle(CLASSE_TOCANDO, !!(convidado && tocando));
}

function adaptadorPlayer() {
    const ouvidos = new WeakSet();
    let aoEvento = null;

    // Os eventos só AVISAM que algo mudou (o mz:estado sai na hora). O estado
    // é sempre lido do <video>: o 'playing' do 1º filme pode sair antes de a
    // ponte começar a ouvir o player (medido no :8443 real, Etapa8/016).
    function ouvirPlayer(player) {
        if (!player || ouvidos.has(player)) return;
        ouvidos.add(player);
        for (const nome of ['playing', 'waiting', 'pause', 'unpause']) {
            Events.on(player, nome, () => aoEvento?.(nome));
        }
    }

    // Carregando = pulando, ou mandado tocar sem dados para tocar
    // (readyState < HAVE_FUTURE_DATA).
    function carregandoAgora() {
        const v = document.querySelector('video.htmlvideoplayer');
        return !!v && (v.seeking || (!v.paused && v.readyState < 3));
    }

    return {
        estado() {
            const player = playbackManager.getCurrentPlayer();
            const item = player ? playbackManager.currentItem(player) : null;
            if (!player || !item) return null;
            const duracao = playbackManager.duration(player);
            return {
                filmeId: item.Id,
                posicaoMs: playbackManager.currentTime(player),
                duracaoMs: duracao ? duracao / 10000 : null,
                pausado: !!playbackManager.paused(player),
                carregando: carregandoAgora(),
                taxa: player.getPlaybackRate?.() ?? 1
            };
        },
        carregar(filmeId, posicaoMs) {
            return playbackManager.play({
                ids: [filmeId],
                serverId: apiClient()?.serverId(),
                startPositionTicks: Math.round(posicaoMs * 10000)
            });
        },
        tocar: () => playbackManager.unpause(),
        pausar: () => playbackManager.pause(),
        pularMs: (ms) => playbackManager.seekMs(ms),
        // direto no player: o do playbackManager grava em sessionStorage e reaplica
        velocidade: (taxa) => playbackManager.getCurrentPlayer()?.setPlaybackRate?.(taxa),
        instalarFunil(intercepta) {
            // Só a chamada de FORA conta: playPause → pause por dentro não é
            // outra ação (nem outro mz:acao).
            let dentro = 0;
            for (const nome of [...TRAVADOS_CONVIDADO, 'stop']) {
                const original = playbackManager[nome];
                if (typeof original !== 'function') continue;
                playbackManager[nome] = function (...args) {
                    if (dentro > 0) return original.apply(this, args);
                    dentro++;
                    try {
                        if (!intercepta(nome, args)) return undefined;
                        return original.apply(this, args);
                    } finally {
                        dentro--;
                    }
                };
            }
        },
        ouvir(f) {
            aoEvento = f;
            ouvirPlayer(playbackManager.getCurrentPlayer());
            Events.on(playbackManager, 'playbackstart', (_e, player) => {
                ouvirPlayer(player);
                f('playbackstart');
            });
            Events.on(playbackManager, 'playbackstop', () => f('playbackstop'));
        },
        marcar
    };
}

export function iniciarPonteVoid() {
    return criarPonte({
        janela: window,
        estado: () => {
            const api = apiClient();
            const usuarioId = api?.getCurrentUserId() || null;
            return { logado: !!(api?.accessToken() && usuarioId), usuarioId };
        },
        iniciarQuickConnect: async () => {
            const api = apiClient();
            const json = await api.ajax({ type: 'POST', url: api.getUrl('/QuickConnect/Initiate') }, true)
                .then(res => res.json());
            return { codigo: json.Code, segredo: json.Secret };
        },
        consultarQuickConnect: async (segredo) => {
            const api = apiClient();
            const data = await api.getJSON(api.getUrl('/QuickConnect/Connect?Secret=' + encodeURIComponent(segredo)));
            return !!data?.Authenticated;
        },
        concluirLogin: async (segredo) => {
            const api = apiClient();
            const result = await api.quickConnect(segredo);
            onServerChanged(result.User.Id, result.AccessToken, api);
            // BUG-054: o navigate('home') entra na FILA do appRouter, que às vezes
            // está presa numa troca de tela antiga — a promessa não resolvia (o
            // mz:login-ok não saía) e, sem esperar por ela, a tela inicial
            // acabava empurrada DEPOIS, por cima do filme que o VOID mandou abrir
            // (medido no :8443, Etapa8/016). Vai direto pelo history, na hora, e
            // só se a aba ainda estiver numa tela de entrada.
            if (EM_LOGIN.test(history.location.pathname)) history.push('/home');
            return result.User.Id;
        },
        sair: async () => {
            await ServerConnections.logout();
            queryClient.clear();
            viewContainer.reset();
        },
        criarExtra: (enviar) => criarPontePlayer({ enviar, player: adaptadorPlayer() })
    });
}
