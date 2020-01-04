import router = require('@koa/router');
import Application = require('koa');
import getRawBody = require('raw-body');
import { settings } from './settings';

import { createThread, replyToThread, getThread, getThreads, getBoards, getFile } from './database/posts';
import { makeChecker } from './r3';
import { ApiV1, Challenge, Identity } from './apiv1';
import multer = require('@koa/multer');
import svgCaptcha = require('svg-captcha')
import { makeJWT, encrypt, getJWTPayload, decrypt, digest } from './utils';

const uploadhandler = multer({
    limits: {
        fields: 10,
        files: 1,
        parts: 20,
        fileSize: 6000 * 1024 * 1024
    }
});

type CurrentApi = ApiV1;
type CurrentApiTypes = CurrentApi[keyof CurrentApi];

let checkDataApiV1 = makeChecker<CurrentApi>();

interface PendingSession {
    isAuth: false;
}

interface AuthSession {
    isAuth: true;
    identity: Required<Identity>;
};

type Session = AuthSession | PendingSession;
type ApiCustom = { request: Application.DefaultContext & { body: any } };
type ApiContext = Application.ParameterizedContext<Session, ApiCustom> & router.RouterParamContext<Session, ApiCustom>;

export let userapi = new router<Session, ApiCustom>({ prefix: '/api' });

const post = <T extends keyof CurrentApi, U extends CurrentApi[keyof CurrentApi]>(path: string, type: T, m: (d: CurrentApi[T], c: ApiContext, n: Application.Next) => U | Promise<U>) =>
    userapi.post(path, bodyCheck(type, async (...a) => await json(a[1], await m(...a))))

const put = <T extends keyof CurrentApi, U extends CurrentApi[keyof CurrentApi]>(path: string, type: T, m: (d: CurrentApi[T], c: ApiContext, n: Application.Next) => U | Promise<U>) =>
    userapi.post(path, bodyCheck(type, async (...a) => await json(a[1], await m(...a))))

const get = (path: string, m: (c: ApiContext, n: Application.Next) => CurrentApiTypes | Promise<CurrentApiTypes>) => {
    userapi.get(path, async (ctx, n) => await json(ctx, await m(ctx, n)))
}

let bodyCheck = <T extends keyof ApiV1>(k: T, f: (p: ApiV1[T], ctx: ApiContext, n: Application.Next) => void | Promise<void>) =>
    (ctx: ApiContext, n: Application.Next) => {
        debugger;
        let body = ctx.body || ctx.request.body;
        if (!checkDataApiV1(k, body))
            ctx.throw(400, "Malformed data");
        return f(body, ctx, n);
    };

// S'assure que l'on ne puisse répondre qu'avec des objets définis dans l'API actuelle
let json = async <T extends CurrentApi[keyof CurrentApi]>(ctx: ApiContext, obj: T | Promise<T>) => {
    ctx.response.headers['content-type'] = 'application/json';
    ctx.body = JSON.stringify(await obj);
}

// Signalement d'erreur au client
userapi.use(async (ctx, next) => {
    try {
        await next();
    } catch (err) {
        ctx.status = err.status || 500;
        if (typeof err == "string") {
            ctx.status = 400;
            json(ctx, { reason: err });
        } else
            json(ctx, { reason: err.message, s: err.stack });
    }
});

userapi.use(async (ctx, next) => {
    // Si le body est du json, on le parse, sinon on continue
    if (ctx.request.type == 'application/json')
        ctx.body = JSON.parse((await getRawBody(ctx.req, { limit: 1024 })).toString());
    return next();
});

userapi.post('/boards/:name', uploadhandler.single('file') as any);

post('/boards/:name', 'PostUploadWithoutFile',
    async (op, ctx) => {
        if (!ctx.request.file)
            ctx.throw(400, 'File missing');
        // cast car typescript ne semble pas voir que file est bien présent
        // aurai ptet mieux marché si file était déclaré en file: {...} | undefined; plutot que file?: {...};
        let id = await createThread(ctx.params.name, op, ctx.request.file, ctx.request.ip);
        return id;
    });

userapi.post('/boards/:name/:id', uploadhandler.single('file') as any, bodyCheck('PostUploadWithoutFile',
    async (post, ctx) => {
        await replyToThread(ctx.params.name, +ctx.params.id, post, ctx.request.file, ctx.request.ip)
        json(ctx, { success: true } as { success: true }); // Ah, yes.
    }
));

get('/boards/:name',
    async ctx => getThreads(ctx.params.name));

get('/boards/:name/:id',
    async ctx => getThread(ctx.params.name, +ctx.params.id));

get('/boards', async () => getBoards());

let extractFile = async (board: string, fn: string) => {
    let fni = parseInt(fn);
    if (isNaN(fni))
        throw "Not found";
    let file = await getFile(board, fni);
    return file;
}

userapi.get('/img/:board/:fn', async (c, n) => {
    let { board, fn } = c.params;
    let file = await extractFile(board, fn);
    c.response.set('content-type', file.mime);
    c.body = file.image.buffer;
});

userapi.get('/img/:board/thumb/:fn', async (c, n) => {
    let { board, fn } = c.params;
    let file = await extractFile(board, fn);
    c.response.set('content-type', 'image/jpg');
    c.body = file.thumbnail.buffer;
});

get('/challenge', (c) => {
    let captcha = svgCaptcha.create({
        height: 72,
        width: 346,
        ignoreChars: 'iIOo0lLe3Eb8B',
        noise: 3,
        size: 6
    });
    let now = +new Date();
    return makeJWT<Challenge>({
        cap: captcha.data,
        verif: makeJWT({ // pour empecher un KPA
            for: c.request.ip,
            exp: now + 5 * 60 * 1000,
            ra: encrypt(Buffer.from(captcha.text), settings.secret).toString('base64')
        })
    });
});

post('/challenge', 'ChallengeAnswer', (ch, c) => {
    let now = +new Date();
    let pl = getJWTPayload(ch.token);
    if (now > pl.exp)
        throw "Token expired";
    if (pl.for != c.request.ip)
        throw "This captcha wasn't issued to you";
    let sol = decrypt(Buffer.from(pl.ra, 'base64'), settings.secret).toString()
    if (sol != ch.ans)
        throw "You have mistyped the captcha";
    return makeJWT({
        for: c.request.ip,
        exp: now + 24 * 60 * 60 * 1000,
    });
})


