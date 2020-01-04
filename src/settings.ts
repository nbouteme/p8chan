export let settings = {
    dbfile: '/home/lillie/p8chan.db',
    initdb: '/home/lillie/init.sql',
    // secret pour les JWTs
    secret: '50b2c6290ea87497f6ef32390197a9b6',
    port: 1234,
    frontend: '/home/lillie/p8/p8chan/dist/p8chan',
    db: {
        host: '127.0.0.1',
        port: 27017,
        database: 'chan',
    }
};
