import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import { getUserLibraryApi } from '@jellyfin/sdk/lib/utils/api/user-library-api';
import { useApi } from 'hooks/useApi';
import './CatalogCardPopup.scss';

const POPUP_W = 420;
const SHOW_DELAY = 380;

function formatRuntime(ticks?: number | null): string | null {
    if (!ticks) return null;
    const min = Math.round(ticks / 10_000_000 / 60);
    return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}min` : `${min}min`;
}

interface PopupContentProps {
    item: BaseItemDto;
    anchorRect: DOMRect;
    onClose: () => void;
}

const PopupContent: React.FC<PopupContentProps> = ({ item, anchorRect, onClose }) => {
    const { api } = useApi();
    const basePath = api?.basePath ?? '';

    const imgUrl = item.BackdropImageTags?.length
        ? `${basePath}/Items/${item.Id}/Images/Backdrop?fillWidth=400&quality=88`
        : item.Id
            ? `${basePath}/Items/${item.Id}/Images/Primary?fillWidth=400&quality=88`
            : null;

    const runtime  = formatRuntime(item.RunTimeTicks);
    const seasons  = item.Type === 'Series' && item.ChildCount != null
        ? `${item.ChildCount} temp.` : null;
    const genres   = item.Genres?.slice(0, 2).join(' · ') ?? '';
    const overview = item.Overview ?? '';

    const serverId = item.ServerId ?? '';
    const detailHref = item.Type === 'Series'
        ? `#/series?id=${item.Id}&serverId=${serverId}`
        : `#/details?id=${item.Id}&serverId=${serverId}`;

    // Center horizontally on the card; align top with card top
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardCenterX = anchorRect.left + anchorRect.width / 2;
    let left = cardCenterX - POPUP_W / 2;
    if (left + POPUP_W > vw - 8) left = vw - POPUP_W - 8;
    if (left < 8) left = 8;

    const estimatedH = POPUP_W * (9 / 16) + 190;
    let top = anchorRect.top;
    if (top + estimatedH > vh - 8) top = Math.max(8, vh - estimatedH - 8);

    return (
        <div
            className='mz-cpopup'
            style={{ left, top, width: POPUP_W }}
            onMouseLeave={onClose}
        >
            {/* Image */}
            <div className='mz-cpopup__img-wrap'>
                {imgUrl
                    ? <img className='mz-cpopup__img' src={imgUrl} alt='' loading='lazy' />
                    : <div className='mz-cpopup__img-placeholder' />
                }
            </div>

            {/* Body */}
            <div className='mz-cpopup__body'>
                {/* Action buttons */}
                <div className='mz-cpopup__actions'>
                    <a className='mz-cpopup-btn mz-cpopup-btn--play' href={detailHref} aria-label='Reproduzir'>
                        <svg viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
                            <path d='M8 5v14l11-7z' />
                        </svg>
                    </a>
                    <button className='mz-cpopup-btn' type='button' aria-label='Adicionar à lista'>
                        <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' aria-hidden='true'>
                            <line x1='12' y1='5' x2='12' y2='19' /><line x1='5' y1='12' x2='19' y2='12' />
                        </svg>
                    </button>
                    <button className='mz-cpopup-btn' type='button' aria-label='Curtir'>
                        <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden='true'>
                            <path d='M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z' />
                            <path d='M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3' />
                        </svg>
                    </button>
                    <a className='mz-cpopup-btn mz-cpopup-btn--info' href={detailHref} aria-label='Mais informações'>
                        <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' aria-hidden='true'>
                            <polyline points='6 9 12 15 18 9' />
                        </svg>
                    </a>
                </div>

                {/* Title */}
                <div className='mz-cpopup__title'>{item.Name}</div>

                {/* Metadata */}
                <div className='mz-cpopup__meta'>
                    {item.OfficialRating && (
                        <span className='mz-cpopup__badge mz-cpopup__badge--age'>{item.OfficialRating}</span>
                    )}
                    {item.ProductionYear && <span>{item.ProductionYear}</span>}
                    {(runtime || seasons) && <span className='mz-cpopup__dot'>·</span>}
                    {seasons
                        ? <span>{seasons}</span>
                        : runtime
                            ? <span>{runtime}</span>
                            : null
                    }
                    {item.IsHD && <span className='mz-cpopup__badge mz-cpopup__badge--hd'>HD</span>}
                </div>

                {genres && <div className='mz-cpopup__genres'>{genres}</div>}
                {overview && <p className='mz-cpopup__desc'>{overview}</p>}
            </div>
        </div>
    );
};

// ============================================================
//  Global hover listener — event delegation on .card elements
// ============================================================
const CatalogCardPopup: React.FC = () => {
    const { api, user } = useApi();
    const [popup, setPopup] = useState<{ item: BaseItemDto; anchorRect: DOMRect } | null>(null);
    const timerRef   = useRef<number | null>(null);
    const activeCard = useRef<Element | null>(null);

    useEffect(() => {
        const cancelTimer = () => {
            if (timerRef.current != null) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };

        const onEnter = (e: MouseEvent) => {
            if (!(e.target instanceof Element)) return;
            const card = e.target.closest('.card.card-hoverable[data-id]');
            if (!card || card === activeCard.current) return;

            cancelTimer();
            activeCard.current = card;

            timerRef.current = window.setTimeout(async () => {
                const id = card.getAttribute('data-id');
                if (!id || !api || !user?.Id) return;

                try {
                    const res = await getUserLibraryApi(api).getItem({
                        userId: user.Id,
                        itemId: id
                    });
                    if (activeCard.current !== card) return; // moved away
                    const rect = card.getBoundingClientRect();
                    setPopup({ item: res.data, anchorRect: rect });
                } catch { /* network error — silently ignore */ }
            }, SHOW_DELAY);
        };

        const onLeave = (e: MouseEvent) => {
            const to = e.relatedTarget;
            if (!(to instanceof Element)) {
                // Leaving to non-element (e.g. browser chrome) — close popup
                cancelTimer();
                activeCard.current = null;
                setPopup(null);
                return;
            }
            // Stay open when moving into the popup or another card
            if (to.closest('.mz-cpopup')) return;
            if (to.closest('.card.card-hoverable[data-id]')) return;

            cancelTimer();
            activeCard.current = null;
            setPopup(null);
        };

        // Close popup on any scroll (page or carousel) so it doesn't float detached
        const onScroll = () => {
            cancelTimer();
            activeCard.current = null;
            setPopup(null);
        };

        document.addEventListener('mouseenter', onEnter, true);
        document.addEventListener('mouseleave', onLeave, true);
        document.addEventListener('scroll', onScroll, true);

        return () => {
            cancelTimer();
            document.removeEventListener('mouseenter', onEnter, true);
            document.removeEventListener('mouseleave', onLeave, true);
            document.removeEventListener('scroll', onScroll, true);
        };
    }, [api, user?.Id]);

    if (!popup) return null;

    return createPortal(
        <PopupContent
            item={popup.item}
            anchorRect={popup.anchorRect}
            onClose={() => {
                activeCard.current = null;
                setPopup(null);
            }}
        />,
        document.body
    );
};

export default CatalogCardPopup;
