import React, { FC } from 'react';
import { Link } from 'react-router-dom';

const ServerButton: FC = () => {
    return (
        <Link
            to='/'
            className='mz-server-logo'
            aria-label='MundoZero'
        >
            <span className='mz-logo-mundo'>MUNDO</span>
            <span className='mz-logo-zero'>ZERO</span>
        </Link>
    );
};

export default ServerButton;
