// Ponte VOID <-> Mundo Zero, versão 2 (PLANO-030 Fase 4, passo 4.3; desenho do
// relatório Etapa8/014 §C.1) — controle do PLAYER, núcleo sem dependências.
//
// INERTE até o VOID mandar void:modo 'dona' ou 'convidado': antes disso não
// instala nada no player, não esconde nada e não manda nada (só o login da
// versão 1 continua). Fora do iframe do VOID a ponte nem liga (ponte.js).
//
//  - dona: o que ela faz no player (botões, teclado, biblioteca) vira mz:acao
//    para o VOID transformar em comando da sala.
//  - convidado: tocar, pausar, pular, trocar de filme e velocidade TRAVADOS no
//    funil (playbackManager) — a tentativa vira mz:bloqueado; volume,
//    legenda, áudio, tela cheia e "sair do filme" (stop) livres (D-R, E.2).
//  - livre: nada travado, velocidade de volta a 1,0, estado não é mais enviado.
// O que a ponte aplica por ordem do VOID NÃO volta como mz:acao (eco).
// Legenda e áudio nunca vêm do VOID (D-R: cada um escolhe).

const ID_FILME = /^[0-9a-f]{32}$/;
const MAX_POSICAO_MS = 48 * 60 * 60 * 1000;
const INTERVALO_ESTADO_MS = 1000;
// "Pronto na posição": perto do pedido e sem estar carregando.
const TOLERANCIA_PRONTO_MS = 2000;
const ATRASO_LER_PULO_MS = 300;

// Métodos do playbackManager que o convidado não pode usar. stop fica livre.
export const TRAVADOS_CONVIDADO = Object.freeze([
    'play', 'pause', 'unpause', 'playPause',
    'seek', 'seekMs', 'seekPercent', 'seekRelative', 'rewind', 'fastForward',
    'nextTrack', 'previousTrack', 'nextChapter', 'previousChapter',
    'setPlaybackRate'
]);

// Para o VOID: o que o convidado tentou (mz:bloqueado { acao }) e o que a dona
// fez (mz:acao { acao }), pelo nome do método.
const ACAO_DO_METODO = {
    play: 'carregar',
    pause: 'pausar',
    unpause: 'tocar',
    seek: 'pular', seekMs: 'pular', seekPercent: 'pular', seekRelative: 'pular',
    rewind: 'pular', fastForward: 'pular',
    nextTrack: 'carregar', previousTrack: 'carregar',
    nextChapter: 'pular', previousChapter: 'pular',
    setPlaybackRate: 'velocidade',
    stop: 'parar'
};

const ehPosicao = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_POSICAO_MS;
const normalizarId = (v) => (typeof v === 'string' ? v.replace(/-/g, '').trim().toLowerCase() : '');

/**
 * @param {object} d
 * @param {(tipo: string, dados: object) => void} d.enviar - postMessage ao VOID (origem fixa, em ponte.js)
 * @param {object} d.player - adaptador do jellyfin-web (index.js):
 *   estado() → { filmeId, posicaoMs, duracaoMs, pausado, carregando, taxa } | null (nada tocando)
 *   carregar(filmeId, posicaoMs), tocar(), pausar(), pularMs(ms), velocidade(taxa)
 *   instalarFunil(intercepta) — embrulha os métodos do playbackManager uma vez;
 *     intercepta(nome, args) → false = não executa
 *   ouvir(aoEvento) — aoEvento(nome) para 'playbackstart' | 'playbackstop' |
 *     'playing' | 'pause' | 'unpause' | 'waiting'
 *   marcar(convidado: bool, nomeDona: string, tocando: bool) — classe no <body> e aviso
 * @param {(f: Function, ms: number) => any} [d.repetir]
 * @param {(id: any) => void} [d.parar]
 * @param {(f: Function, ms: number) => any} [d.depois]
 */
export function criarPontePlayer({
    enviar,
    player,
    repetir = (f, ms) => setInterval(f, ms),
    parar = (id) => clearInterval(id),
    depois = (f, ms) => setTimeout(f, ms)
}) {
    let modo = 'livre';
    let nomeDona = '';
    let funilInstalado = false;
    let ouvindo = false;
    let relogio = null;
    let aplicando = 0; // > 0 = a chamada veio da própria ponte
    let inicioEsperado = null; // filme que a ponte mandou carregar (eco do playbackstart)
    let pausarAoTocar = false; // void:carregar com pausado = true
    let pendente = null; // { filmeId, alvoMs } esperando o mz:pronto
    let ultimoEstado = '';

    function ativo() {
        return modo === 'dona' || modo === 'convidado';
    }

    // Chama o player COMO PONTE: passa pelo funil sem travar e sem virar mz:acao.
    function comoPonte(f) {
        aplicando++;
        try {
            return f();
        } finally {
            aplicando--;
        }
    }

    function ler() {
        const e = player.estado();
        if (!e || !e.filmeId) return { estado: 'parado', posicaoMs: 0, filmeId: null, duracaoMs: null, taxa: 1 };
        let estado = 'tocando';
        if (e.carregando) estado = 'carregando';
        else if (e.pausado) estado = 'pausado';
        return {
            estado,
            posicaoMs: Math.max(0, Math.round(e.posicaoMs || 0)),
            filmeId: normalizarId(e.filmeId),
            duracaoMs: e.duracaoMs == null ? null : Math.round(e.duracaoMs),
            taxa: typeof e.taxa === 'number' ? e.taxa : 1
        };
    }

    function contarEstado() {
        if (!ativo()) return;
        const e = ler();
        enviar('mz:estado', e);
        player.marcar(modo === 'convidado', nomeDona, e.estado !== 'parado');
        ultimoEstado = e.estado;
        if (pendente && e.filmeId === pendente.filmeId && e.estado !== 'carregando'
            && Math.abs(e.posicaoMs - pendente.alvoMs) <= TOLERANCIA_PRONTO_MS) {
            const { filmeId } = pendente;
            pendente = null;
            enviar('mz:pronto', { filmeId, posicaoMs: e.posicaoMs });
        }
    }

    // O funil: toda chamada desses métodos do playbackManager passa por aqui.
    function intercepta(nome) {
        if (aplicando > 0 || !ativo()) return true;
        if (modo === 'convidado') {
            if (!TRAVADOS_CONVIDADO.includes(nome)) return true;
            enviar('mz:bloqueado', { acao: ACAO_DO_METODO[nome] || nome });
            return false;
        }
        // dona: deixa e conta ao VOID. Filme novo sai pelo playbackstart (cobre
        // play, próximo episódio e a tela "Próximo"); pulo é lido logo depois.
        if (nome === 'pause' || nome === 'unpause' || nome === 'playPause') {
            const pausado = nome === 'pause' || (nome === 'playPause' && ler().estado !== 'pausado');
            const e = ler();
            enviar('mz:acao', { acao: pausado ? 'pausar' : 'tocar', filmeId: e.filmeId, posicaoMs: e.posicaoMs });
        } else if (ACAO_DO_METODO[nome] === 'pular') {
            depois(() => {
                const e = ler();
                enviar('mz:acao', { acao: 'pular', filmeId: e.filmeId, posicaoMs: e.posicaoMs });
            }, ATRASO_LER_PULO_MS);
        } else if (nome === 'stop') {
            const e = ler();
            enviar('mz:acao', { acao: 'parar', filmeId: e.filmeId, posicaoMs: e.posicaoMs });
        }
        return true;
    }

    function aoEvento(nome) {
        if (!ativo()) return;
        if (nome === 'playbackstart') {
            const e = ler();
            if (inicioEsperado && e.filmeId === inicioEsperado) {
                inicioEsperado = null; // eco do void:carregar
            } else if (modo === 'dona' && e.filmeId) {
                enviar('mz:acao', { acao: 'carregar', filmeId: e.filmeId, posicaoMs: e.posicaoMs });
            }
        }
        if (nome === 'playing' && pausarAoTocar) {
            pausarAoTocar = false;
            comoPonte(() => player.pausar());
        }
        contarEstado();
    }

    function ligar() {
        if (!funilInstalado) {
            player.instalarFunil(intercepta);
            funilInstalado = true;
        }
        if (!ouvindo) {
            player.ouvir(aoEvento);
            ouvindo = true;
        }
        if (relogio == null) relogio = repetir(contarEstado, INTERVALO_ESTADO_MS);
    }

    function desligar() {
        if (relogio != null) {
            parar(relogio);
            relogio = null;
        }
        pendente = null;
        inicioEsperado = null;
        pausarAoTocar = false;
        comoPonte(() => player.velocidade(1));
        player.marcar(false, '', false);
    }

    function aoModo(m) {
        if (m.modo !== 'dona' && m.modo !== 'convidado' && m.modo !== 'livre') return;
        const antes = modo;
        modo = m.modo;
        nomeDona = typeof m.dona === 'string' ? m.dona.slice(0, 60) : '';
        if (modo === 'livre') {
            if (antes !== 'livre') desligar();
            return;
        }
        ligar();
        contarEstado();
    }

    function aoCarregar(m) {
        const filmeId = normalizarId(m.filmeId);
        if (!ID_FILME.test(filmeId) || !ehPosicao(m.posicaoMs) || typeof m.pausado !== 'boolean') return;
        const e = ler();
        pendente = { filmeId, alvoMs: m.posicaoMs };
        if (e.filmeId === filmeId && e.estado !== 'parado') {
            // já está nesse filme: só posiciona (não recarrega)
            comoPonte(() => player.pularMs(m.posicaoMs));
            comoPonte(() => (m.pausado ? player.pausar() : player.tocar()));
        } else {
            inicioEsperado = filmeId;
            pausarAoTocar = m.pausado;
            comoPonte(() => player.carregar(filmeId, m.posicaoMs));
        }
        contarEstado();
    }

    function aoTocar(m) {
        if (!ehPosicao(m.posicaoMs)) return;
        const e = ler();
        if (e.estado === 'parado') return;
        if (Math.abs(e.posicaoMs - m.posicaoMs) > 3000) comoPonte(() => player.pularMs(m.posicaoMs));
        comoPonte(() => player.tocar());
        contarEstado();
    }

    function aoPausar(m) {
        if (!ehPosicao(m.posicaoMs)) return;
        const e = ler();
        if (e.estado === 'parado') return;
        comoPonte(() => player.pausar());
        if (Math.abs(e.posicaoMs - m.posicaoMs) > 500) comoPonte(() => player.pularMs(m.posicaoMs));
        contarEstado();
    }

    function aoPular(m) {
        if (!ehPosicao(m.posicaoMs)) return;
        const e = ler();
        if (e.estado === 'parado') return;
        pendente = { filmeId: e.filmeId, alvoMs: m.posicaoMs };
        comoPonte(() => player.pularMs(m.posicaoMs));
        contarEstado();
    }

    function aoVelocidade(m) {
        if (typeof m.taxa !== 'number' || !(m.taxa >= 0.95 && m.taxa <= 1.05)) return;
        comoPonte(() => player.velocidade(m.taxa));
    }

    const comandos = new Map([
        ['void:carregar', aoCarregar],
        ['void:tocar', aoTocar],
        ['void:pausar', aoPausar],
        ['void:pular', aoPular],
        ['void:velocidade', aoVelocidade]
    ]);

    /** @returns {boolean} true = a mensagem era desta parte da ponte */
    function receber(m) {
        if (m.tipo === 'void:modo') {
            aoModo(m);
            return true;
        }
        const tratar = comandos.get(m.tipo);
        if (!tratar) return false;
        // inerte: comando antes do void:modo (ou no modo livre) é ignorado
        if (ativo()) tratar(m);
        return true;
    }

    return {
        receber,
        modo: () => modo,
        ultimoEstado: () => ultimoEstado,
        // para os testes: o funil como o index.js o instala
        intercepta
    };
}

