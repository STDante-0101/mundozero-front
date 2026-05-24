import React, { useMemo } from 'react';

const generate = (count: number): string => {
    const stars: string[] = [];
    for (let i = 0; i < count; i++) {
        const x = Math.floor(Math.random() * 2000);
        const y = Math.floor(Math.random() * 1200);
        const a = (Math.random() * 0.6 + 0.2).toFixed(2);
        stars.push(`${x}px ${y}px rgba(255,255,255,${a})`);
    }
    return stars.join(', ');
};

const Starfield: React.FC = () => {
    const small = useMemo(() => generate(280), []);
    const med = useMemo(() => generate(80), []);
    const bright = useMemo(() => generate(20), []);

    return (
        <div className='mz-starfield' aria-hidden='true'>
            <div className='mz-stars mz-stars-small' style={{ boxShadow: small }} />
            <div className='mz-stars mz-stars-med' style={{ boxShadow: med }} />
            <div className='mz-stars mz-stars-bright' style={{ boxShadow: bright }} />
            <div className='mz-vignette' />
        </div>
    );
};

export default Starfield;
