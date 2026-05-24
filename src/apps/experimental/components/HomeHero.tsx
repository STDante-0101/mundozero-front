import React, { useEffect, useRef, useState } from 'react';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields';
import { useQuery } from '@tanstack/react-query';
import { getUserLibraryApi } from '@jellyfin/sdk/lib/utils/api/user-library-api';

import { useApi } from 'hooks/useApi';
import { itemHref } from './mzLinks';

import './HomeHero.scss';

const ROTATION_MS = 8000;

function getBackdropUrl(item: BaseItemDto, basePath: string): string | null {
    const tag = item.BackdropImageTags?.[0];
    if (!tag || !item.Id) return null;
    return `${basePath}/Items/${item.Id}/Images/${ImageType.Backdrop}/0?tag=${tag}&quality=90&maxWidth=1920`;
}

function getLogoUrl(item: BaseItemDto, basePath: string): string | null {
    const tag = item.ImageTags?.Logo;
    if (!tag || !item.Id) return null;
    return `${basePath}/Items/${item.Id}/Images/${ImageType.Logo}?tag=${tag}&maxWidth=400`;
}

const HomeHero: React.FC = () => {
    const { api, user } = useApi();
    const [idx, setIdx] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const { data: items } = useQuery({
        queryKey: ['HomeHero', user?.Id],
        queryFn: async ({ signal }) => {
            if (!api || !user?.Id) return [];
            const res = await getUserLibraryApi(api).getLatestMedia(
                {
                    userId: user.Id,
                    limit: 6,
                    includeItemTypes: [BaseItemKind.Movie, BaseItemKind.Series],
                    fields: [
                        ItemFields.Overview,
                        ItemFields.Genres
                    ],
                    enableImageTypes: [ImageType.Backdrop, ImageType.Logo, ImageType.Primary],
                    imageTypeLimit: 1
                },
                { signal }
            );
            return (res.data || []).filter(it => it.BackdropImageTags && it.BackdropImageTags.length > 0);
        },
        enabled: !!api && !!user?.Id
    });

    useEffect(() => {
        if (!items?.length) return;
        timerRef.current = setInterval(() => {
            setIdx(i => (i + 1) % items.length);
        }, ROTATION_MS);
        return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }, [items?.length]);

    if (!items?.length || !api?.basePath) return null;

    const item = items[idx];
    const logoUrl = getLogoUrl(item, api.basePath);

    const goto = (next: number) => {
        setIdx(next);
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(() => setIdx(i => (i + 1) % items.length), ROTATION_MS);
    };

    // Build metadata chips
    const metaChips: React.ReactNode[] = [];
    if (item.OfficialRating) {
        metaChips.push(
            <span key='rating' className='mz-hero__badge mz-hero__badge--rating'>{item.OfficialRating}</span>
        );
    }
    if (item.ProductionYear) {
        metaChips.push(<span key='year'>{item.ProductionYear}</span>);
    }
    if (item.Type === 'Series' && item.ChildCount != null && item.ChildCount > 0) {
        metaChips.push(<span key='seasons'>{item.ChildCount} Temporada{item.ChildCount !== 1 ? 's' : ''}</span>);
    } else if (item.RunTimeTicks) {
        const mins = Math.round(item.RunTimeTicks / 600_000_000);
        metaChips.push(<span key='runtime'>{mins} min</span>);
    }
    if (item.CommunityRating && item.CommunityRating > 0) {
        metaChips.push(
            <span key='score' className='mz-hero__badge mz-hero__badge--sentiment'>
                ★ {item.CommunityRating.toFixed(1)}
            </span>
        );
    }
    if (item.Genres?.length) {
        metaChips.push(<span key='genres'>{item.Genres.slice(0, 3).join(' · ')}</span>);
    }

    return (
        <section className='mz-hero' aria-label='Destaque'>
            {/* Backdrop layers */}
            {items.map((it, i) => {
                const bg = getBackdropUrl(it, api.basePath!);
                return (
                    <div
                        key={it.Id}
                        className={`mz-hero__bg ${i === idx ? 'is-active' : ''}`}
                        style={bg ? { backgroundImage: `url('${bg}')` } : {}}
                    >
                        <div className='mz-hero__bg-protection' />
                    </div>
                );
            })}

            {/* Content */}
            <div className='mz-hero__content'>
                <div className='mz-hero__kicker'>EM ALTA</div>

                {logoUrl ? (
                    <img
                        className='mz-hero__logo'
                        src={logoUrl}
                        alt={item.Name ?? ''}
                    />
                ) : (
                    <h1 className='mz-hero__title'>{item.Name}</h1>
                )}

                {metaChips.length > 0 && (
                    <div className='mz-hero__meta'>
                        {metaChips.map((chip, i) => (
                            <React.Fragment key={i}>
                                {i > 0 && <span className='mz-hero__dot-sep'>·</span>}
                                {chip}
                            </React.Fragment>
                        ))}
                    </div>
                )}

                {item.Overview && (
                    <p className='mz-hero__desc'>{item.Overview}</p>
                )}

                <div className='mz-hero__cta'>
                    <a href={itemHref(item)} className='mz-btn mz-btn--primary'>
                        <svg viewBox='0 0 24 24' fill='currentColor' width='18' height='18' aria-hidden='true'>
                            <path d='M8 5v14l11-7z' />
                        </svg>
                        Assistir agora
                    </a>
                    <a href={itemHref(item)} className='mz-btn mz-btn--ghost'>
                        <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' width='17' height='17' aria-hidden='true'>
                            <circle cx='12' cy='12' r='10' />
                            <line x1='12' y1='8' x2='12' y2='16' />
                            <line x1='8' y1='12' x2='16' y2='12' />
                        </svg>
                        Mais informações
                    </a>
                    <button className='mz-btn mz-btn--round' type='button' aria-label='Adicionar à lista'>
                        <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' aria-hidden='true'>
                            <line x1='12' y1='5' x2='12' y2='19' />
                            <line x1='5' y1='12' x2='19' y2='12' />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Dot navigation */}
            {items.length > 1 && (
                <div className='mz-hero__dots' role='tablist' aria-label='Slides'>
                    {items.map((_, i) => (
                        <button
                            key={i}
                            role='tab'
                            aria-selected={i === idx}
                            className={`mz-hero__dot ${i === idx ? 'is-active' : ''}`}
                            onClick={() => goto(i)}
                            aria-label={`Slide ${i + 1}`}
                        />
                    ))}
                </div>
            )}
        </section>
    );
};

export default HomeHero;
