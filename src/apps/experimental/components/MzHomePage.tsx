import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields';
import { ItemFilter } from '@jellyfin/sdk/lib/generated-client/models/item-filter';
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by';
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order';
import { getItemsApi } from '@jellyfin/sdk/lib/utils/api/items-api';
import { getUserLibraryApi } from '@jellyfin/sdk/lib/utils/api/user-library-api';
import { useQuery } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';
import viewManager from 'components/viewManager/viewManager';
import HomeHero from './HomeHero';
import { itemHref } from './mzLinks';
import './MzHomePage.scss';

// ============================================================
//  Black Hole
// ============================================================
const BlackHole: React.FC<{ size?: number }> = ({ size = 240 }) => (
    <div className='mz-bh' style={{ width: size, height: size }}>
        <div className='mz-bh__glow' />
        <div className='mz-bh__disk--back' />
        <div className='mz-bh__lens' />
        <div className='mz-bh__horizon' />
        <div className='mz-bh__disk--front' />
        <div className='mz-bh__beam' />
    </div>
);

// ============================================================
//  Suck animation — splits text into per-word spans
// ============================================================
const SuckText: React.FC<{ text: string; baseDelay?: number; step?: number }> = ({
    text, baseDelay = 0, step = 50
}) => (
    <>
        {text.split(' ').map((word, i) => (
            <span
                key={i}
                className='mz-suck__word'
                style={{ '--d': `${baseDelay + i * step}ms` } as React.CSSProperties}
            >
                {word}{' '}
            </span>
        ))}
    </>
);

// ============================================================
//  Diversão 100% — floating, no card background
// ============================================================
const DiversaoCard: React.FC<{ items: BaseItemDto[] }> = ({ items }) => {
    const pick = () => {
        if (!items.length) return;
        const it = items[Math.floor(Math.random() * items.length)];
        const href = itemHref(it);
        if (href) window.location.hash = href;
    };

    return (
        <section className='mz-diversao' aria-label='Diversão 100%'>
            <div className='mz-diversao__bh'>
                <BlackHole size={480} />
            </div>
            <div className='mz-diversao__body'>
                <div className='mz-diversao__kicker'>
                    <span className='mz-suck__word' style={{ '--d': '0ms' } as React.CSSProperties}>
                        UM CANAL SÓ SEU
                    </span>
                </div>

                <h2 className='mz-diversao__title'>
                    <SuckText text='Diversão 100%' baseDelay={60} step={80} />
                </h2>

                <p className='mz-diversao__desc'>
                    <SuckText
                        text='Aperte sintonizar e o canal escolhe um episódio. Sem decidir, sem rolar.'
                        baseDelay={300}
                        step={35}
                    />
                </p>

                <button
                    className='mz-diversao__btn mz-suck__word'
                    style={{ '--d': '900ms' } as React.CSSProperties}
                    type='button'
                    onClick={pick}
                >
                    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'
                        strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                        <rect x='2' y='7' width='20' height='15' rx='2' ry='2' />
                        <polyline points='17 2 12 7 7 2' />
                    </svg>
                    Sintonizar canal
                </button>
            </div>
        </section>
    );
};

// ============================================================
//  Image URL helpers
// ============================================================
function getPosterUrl(item: BaseItemDto, basePath: string, variant: 'portrait' | 'landscape'): string | null {
    if (variant === 'landscape') {
        const thumbTag = item.ImageTags?.Thumb;
        if (thumbTag && item.Id) return `${basePath}/Items/${item.Id}/Images/Thumb?tag=${thumbTag}&fillWidth=360&quality=90`;
        const bgTag = item.BackdropImageTags?.[0];
        if (bgTag && item.Id) return `${basePath}/Items/${item.Id}/Images/Backdrop/0?tag=${bgTag}&fillWidth=360&quality=90`;
    }
    const primaryTag = item.ImageTags?.Primary;
    if (primaryTag && item.Id) return `${basePath}/Items/${item.Id}/Images/Primary?tag=${primaryTag}&fillWidth=280&quality=90`;
    return null;
}

// Popup always uses landscape image for a compact, consistent popup card
function getPopupImageUrl(item: BaseItemDto, basePath: string): string | null {
    const bgTag = item.BackdropImageTags?.[0];
    if (bgTag && item.Id) return `${basePath}/Items/${item.Id}/Images/Backdrop/0?tag=${bgTag}&fillWidth=420&quality=90`;
    const thumbTag = item.ImageTags?.Thumb;
    if (thumbTag && item.Id) return `${basePath}/Items/${item.Id}/Images/Thumb?tag=${thumbTag}&fillWidth=420&quality=90`;
    const primaryTag = item.ImageTags?.Primary;
    if (primaryTag && item.Id) return `${basePath}/Items/${item.Id}/Images/Primary?tag=${primaryTag}&fillWidth=300&quality=90`;
    return null;
}

function formatRuntime(ticks?: number | null): string | null {
    if (!ticks) return null;
    const totalMins = Math.round(ticks / (10_000_000 * 60));
    if (!totalMins) return null;
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

// ============================================================
//  Card Hover Popup — rendered via portal to escape overflow:hidden
// ============================================================
const POPUP_W = 420;

interface PopupProps {
    item: BaseItemDto;
    basePath: string;
    rect: DOMRect;
    variant: 'portrait' | 'landscape';
    onEnter: () => void;
    onClose: () => void;
}

const CardPopup: React.FC<PopupProps> = ({ item, basePath, rect, variant, onEnter, onClose }) => {
    const popupW = POPUP_W;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Center horizontally on the card
    let left = rect.left + rect.width / 2 - popupW / 2;
    left = Math.max(8, Math.min(left, vw - popupW - 8));

    // Align top with card top; push up if it would go off-screen
    const estimatedH = popupW * (9 / 16) + 190;
    let top = rect.top;
    if (top + estimatedH > vh - 8) top = Math.max(8, vh - estimatedH - 8);

    const imgUrl = getPopupImageUrl(item, basePath);
    const genres = item.Genres?.slice(0, 2).join(' · ') ?? '';
    const overview = item.Overview ?? '';
    const href = itemHref(item);
    const runtime = formatRuntime(item.RunTimeTicks);
    const seasons = item.Type === 'Series' && item.ChildCount
        ? `${item.ChildCount} temporada${item.ChildCount !== 1 ? 's' : ''}`
        : null;

    return createPortal(
        <div
            className='mz-card-popup'
            style={{ left, top, width: popupW }}
            onMouseEnter={onEnter}
            onMouseLeave={onClose}
        >
            <div className='mz-card-popup__img-wrap'>
                {imgUrl ? (
                    <img className='mz-card-popup__img' src={imgUrl} alt='' loading='lazy' />
                ) : (
                    <div className='mz-card-popup__img-placeholder'>
                        <span>{item.Name}</span>
                    </div>
                )}
            </div>
            <div className='mz-card-popup__body'>
                {/* 4 action buttons — play, add, like, chevron (details) */}
                <div className='mz-card-popup__actions'>
                    <a className='mz-popup-btn mz-popup-btn--play' href={href}
                        aria-label={`Assistir ${item.Name ?? ''}`}>
                        <svg viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
                            <polygon points='5 3 19 12 5 21 5 3' />
                        </svg>
                    </a>
                    <button className='mz-popup-btn' type='button' aria-label='Adicionar à lista'>
                        <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5'
                            strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                            <line x1='12' y1='5' x2='12' y2='19' /><line x1='5' y1='12' x2='19' y2='12' />
                        </svg>
                    </button>
                    <button className='mz-popup-btn' type='button' aria-label='Curtir'>
                        <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'
                            strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                            <path d='M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z' />
                            <path d='M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3' />
                        </svg>
                    </button>
                    <a className='mz-popup-btn mz-popup-btn--chevron' href={href}
                        aria-label={`Mais sobre ${item.Name ?? ''}`}>
                        <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5'
                            strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                            <polyline points='6 9 12 15 18 9' />
                        </svg>
                    </a>
                </div>

                <div className='mz-card-popup__title'>{item.Name}</div>

                {/* Meta: [age badge] year · duration/seasons [HD] */}
                <div className='mz-card-popup__meta'>
                    {item.OfficialRating && (
                        <span className='mz-popup-age'>{item.OfficialRating}</span>
                    )}
                    {item.ProductionYear && <span>{item.ProductionYear}</span>}
                    {(runtime || seasons) && <span>·</span>}
                    {seasons ? <span>{seasons}</span> : runtime ? <span>{runtime}</span> : null}
                    {item.IsHD && <span className='mz-popup-hd'>HD</span>}
                </div>

                {genres && <div className='mz-card-popup__genres'>{genres}</div>}
                {overview && <p className='mz-card-popup__desc'>{overview}</p>}
            </div>
        </div>,
        document.body
    );
};

// ============================================================
//  Media Card
// ============================================================
interface CardProps {
    item: BaseItemDto;
    basePath: string;
    variant?: 'portrait' | 'landscape';
    progress?: number;
}

const MzCard: React.FC<CardProps> = ({ item, basePath, variant = 'portrait', progress }) => {
    const [popupRect, setPopupRect] = useState<DOMRect | null>(null);
    const cardRef = useRef<HTMLAnchorElement>(null);
    const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Cleanup timers on unmount
    useEffect(() => () => {
        if (showTimer.current) clearTimeout(showTimer.current);
        if (hideTimer.current) clearTimeout(hideTimer.current);
    }, []);

    const handleCardEnter = useCallback(() => {
        if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
        showTimer.current = setTimeout(() => {
            if (cardRef.current) setPopupRect(cardRef.current.getBoundingClientRect());
        }, 380);
    }, []);

    const handleCardLeave = useCallback(() => {
        if (showTimer.current) { clearTimeout(showTimer.current); showTimer.current = null; }
        hideTimer.current = setTimeout(() => setPopupRect(null), 150);
    }, []);

    const handlePopupEnter = useCallback(() => {
        if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    }, []);

    const handlePopupLeave = useCallback(() => setPopupRect(null), []);

    // Close popup on any scroll so it doesn't float detached from the card
    useEffect(() => {
        const onScroll = () => {
            if (showTimer.current) { clearTimeout(showTimer.current); showTimer.current = null; }
            setPopupRect(null);
        };
        document.addEventListener('scroll', onScroll, true);
        return () => document.removeEventListener('scroll', onScroll, true);
    }, []);

    const imgUrl = getPosterUrl(item, basePath, variant);
    const href = itemHref(item);

    return (
        <>
            <a
                ref={cardRef}
                className={`mz-card mz-card--${variant}`}
                href={href}
                aria-label={item.Name ?? ''}
                onMouseEnter={handleCardEnter}
                onMouseLeave={handleCardLeave}
            >
                <div className='mz-card__media'>
                    {imgUrl ? (
                        <img className='mz-card__img' src={imgUrl} alt='' loading='lazy' />
                    ) : (
                        <div className='mz-card__img mz-card__placeholder'>
                            <span>{item.Name}</span>
                        </div>
                    )}
                    {variant === 'landscape' && progress != null && progress > 0 && (
                        <div className='mz-card__progress'>
                            <span className='mz-card__progress-fill' style={{ width: `${progress}%` }} />
                        </div>
                    )}
                </div>
                <div className='mz-card__meta'>
                    <div className='mz-card__name'>{item.Name}</div>
                    {item.ProductionYear && <div className='mz-card__year'>{item.ProductionYear}</div>}
                </div>
            </a>
            {popupRect && (
                <CardPopup
                    item={item}
                    basePath={basePath}
                    rect={popupRect}
                    variant={variant}
                    onEnter={handlePopupEnter}
                    onClose={handlePopupLeave}
                />
            )}
        </>
    );
};

// ============================================================
//  Content Row
// ============================================================
interface RowProps {
    title: string;
    items: BaseItemDto[];
    basePath: string;
    variant?: 'portrait' | 'landscape';
    getProgress?: (item: BaseItemDto) => number | undefined;
}

const MzRow: React.FC<RowProps> = ({ title, items, basePath, variant = 'portrait', getProgress }) => {
    const ref = useRef<HTMLDivElement>(null);
    const scroll = (dir: number) => {
        ref.current?.scrollBy({ left: (ref.current.clientWidth * 0.75) * dir, behavior: 'smooth' });
    };

    if (!items.length) return null;

    return (
        <section className='mz-row'>
            <div className='mz-row__head'>
                <h2 className='mz-row__title'>{title}</h2>
            </div>
            <div className='mz-row__track-wrap'>
                <button className='mz-row__arrow mz-row__arrow--prev' aria-label='Anterior' onClick={() => scroll(-1)} type='button'>
                    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><polyline points='15 18 9 12 15 6' /></svg>
                </button>
                <div className={`mz-row__track mz-row__track--${variant}`} ref={ref}>
                    {items.map((item) => (
                        <MzCard
                            key={item.Id}
                            item={item}
                            basePath={basePath}
                            variant={variant}
                            progress={getProgress?.(item)}
                        />
                    ))}
                </div>
                <button className='mz-row__arrow mz-row__arrow--next' aria-label='Próximo' onClick={() => scroll(1)} type='button'>
                    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><polyline points='9 18 15 12 9 6' /></svg>
                </button>
            </div>
        </section>
    );
};

// ============================================================
//  Home Page
// ============================================================
const MzHomePage: React.FC = () => {
    const { api, user } = useApi();
    const basePath = api?.basePath ?? '';

    // Hide any legacy viewManager DOM left by detail/other pages when navigating back
    useEffect(() => {
        viewManager.hideView();
    }, []);

    const { data: resumeData } = useQuery({
        queryKey: ['mz-resume', user?.Id],
        queryFn: async ({ signal }) => {
            if (!api || !user?.Id) return { items: [] as BaseItemDto[], kind: 'none' as const };

            const FIELDS = [
                ItemFields.PrimaryImageAspectRatio,
                ItemFields.MediaSourceCount,
                ItemFields.Genres,
                ItemFields.Overview
            ] as const;
            const IMAGES = [ImageType.Primary, ImageType.Thumb, ImageType.Backdrop] as const;

            // 1st: truly in-progress items (started, not finished)
            try {
                const r1 = await getItemsApi(api).getResumeItems({
                    userId: user.Id, limit: 12, fields: [...FIELDS],
                    imageTypeLimit: 1, enableImageTypes: [...IMAGES],
                    enableTotalRecordCount: false,
                    includeItemTypes: [BaseItemKind.Movie, BaseItemKind.Episode]
                }, { signal });
                const inProgress = r1.data?.Items ?? [];
                if (inProgress.length > 0) return { items: inProgress, kind: 'resume' as const };
            } catch { /* endpoint unavailable — fall through */ }

            // 2nd fallback: recently played items sorted by last played date
            try {
                const r2 = await getItemsApi(api).getItems({
                    userId: user.Id, limit: 12,
                    sortBy: [ItemSortBy.DatePlayed], sortOrder: [SortOrder.Descending],
                    filters: [ItemFilter.IsPlayed],
                    includeItemTypes: [BaseItemKind.Movie, BaseItemKind.Episode],
                    recursive: true, fields: [...FIELDS],
                    imageTypeLimit: 1, enableImageTypes: [...IMAGES], enableTotalRecordCount: false
                }, { signal });
                const recentPlayed = r2.data?.Items ?? [];
                if (recentPlayed.length > 0) return { items: recentPlayed, kind: 'recent' as const };
            } catch { /* endpoint unavailable — fall through */ }

            return { items: [] as BaseItemDto[], kind: 'none' as const };
        },
        enabled: !!api && !!user?.Id,
        refetchOnMount: 'always',
        staleTime: 0
    });

    const resumeItems = resumeData?.items ?? [];
    const resumeKind  = resumeData?.kind  ?? 'none';
    const resumeTitle = resumeKind === 'resume' ? 'Continue assistindo' : 'Assistidos recentemente';

    const { data: latestMovies = [] } = useQuery({
        queryKey: ['mz-movies', user?.Id],
        queryFn: async ({ signal }) => {
            if (!api || !user?.Id) return [];
            const res = await getUserLibraryApi(api).getLatestMedia({
                userId: user.Id,
                limit: 20,
                includeItemTypes: [BaseItemKind.Movie],
                fields: [ItemFields.Genres, ItemFields.Overview],
                enableImageTypes: [ImageType.Primary, ImageType.Backdrop, ImageType.Thumb],
                imageTypeLimit: 1
            }, { signal });
            return res.data ?? [];
        },
        enabled: !!api && !!user?.Id
    });

    const { data: latestSeries = [] } = useQuery({
        queryKey: ['mz-series', user?.Id],
        queryFn: async ({ signal }) => {
            if (!api || !user?.Id) return [];
            const res = await getUserLibraryApi(api).getLatestMedia({
                userId: user.Id,
                limit: 20,
                includeItemTypes: [BaseItemKind.Series],
                fields: [ItemFields.Genres, ItemFields.Overview],
                enableImageTypes: [ImageType.Primary, ImageType.Backdrop, ImageType.Thumb],
                imageTypeLimit: 1
            }, { signal });
            return res.data ?? [];
        },
        enabled: !!api && !!user?.Id
    });

    const allItems = useMemo(() => [...latestMovies, ...latestSeries], [latestMovies, latestSeries]);
    const getProgress = (item: BaseItemDto) => {
        const p = item.UserData?.PlayedPercentage;
        // skip fully-played items — fallback "recently watched" items show 0 bar
        if (p == null || p >= 100) return undefined;
        return Math.round(p);
    };

    return (
        <div className='mz-home'>
            <HomeHero />

            <div className='mz-home__rows'>
                {/* Continue assistindo — aparece quando o usuário tem histórico de reprodução */}
                {resumeItems.length > 0 && (
                    <MzRow
                        title={resumeTitle}
                        items={resumeItems}
                        basePath={basePath}
                        variant='landscape'
                        getProgress={resumeKind === 'resume' ? getProgress : undefined}
                    />
                )}

                <DiversaoCard items={allItems} />

                {/* Em destaque — sempre após o DiversaoCard */}
                {latestMovies.length > 0 && (
                    <MzRow title='Em destaque' items={latestMovies} basePath={basePath} variant='portrait' />
                )}
                {latestSeries.length > 0 && (
                    <MzRow title='Séries' items={latestSeries} basePath={basePath} variant='portrait' />
                )}
            </div>

            <footer className='mz-footer'>
                <span className='mz-footer__logo'>MUNDO<span>ZERO</span></span>
                <span>Servidor pessoal · Uso doméstico</span>
            </footer>
        </div>
    );
};

export default MzHomePage;
