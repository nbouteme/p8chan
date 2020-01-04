import router = require('@koa/router');
import Application = require('koa');
import getRawBody = require('raw-body');

import { getJWTPayload, hashPassword, makeJWT, checkJWT } from './utils';
import { getUserByName, noAdmin, createUser } from './database/users';
import { createBoard, setBoard, deleteBoard } from './database/posts';
import { makeChecker } from './r3';
import { ApiV1, JWT, Identity } from './apiv1';

type CurrentApi = ApiV1;
type CurrentApiTypes = CurrentApi[keyof CurrentApi];

let checkDataApiV1    = makeChecker<CurrentApi>();

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

export let adminapi = new router<Session, ApiCustom>({ prefix: '/admin' });

const post = <T extends keyof CurrentApi>(path: string, type: T, m: (d: CurrentApi[T], c: ApiContext, n: Application.Next) => void) => {
    adminapi.post(path, bodyCheck(type, m))
}

const put = <T extends keyof CurrentApi>(path: string, type: T, m: (d: CurrentApi[T], c: ApiContext, n: Application.Next) => void) => {
    adminapi.put(path, bodyCheck(type, m))
}

const get = (path: string, m: (c: ApiContext, n: Application.Next) => CurrentApiTypes | Promise<CurrentApiTypes>) => {
    adminapi.get(path, async (ctx, n) => json(ctx, await m(ctx, n)))
}

let bodyCheck = <T extends keyof ApiV1>(k: T, f: (p: ApiV1[T], ctx: ApiContext, n: Application.Next) => void | Promise<void>) =>
    (ctx: ApiContext, n: Application.Next) => {
        let body = ctx.body || ctx.request.body;
        if (!checkDataApiV1(k, body))
            ctx.throw(400, "Malformed data");
        return f(body, ctx, n);
    };

// S'assure que l'on ne puisse répondre qu'avec des objets définis dans l'API actuelle
let json = <T extends CurrentApi[keyof CurrentApi]>(ctx: ApiContext, obj: T) => {
    ctx.response.headers['content-type'] = 'application/json';
    ctx.body = JSON.stringify(obj);
}

// Signalement d'erreur au client
adminapi.use(async (ctx, next) => {
    try {
        await next();
    } catch (err) {
        ctx.status = err.status || 500;
        json(ctx, { reason: err.message, s: err.stack });
    }
});

adminapi.use(async (ctx, next) => {
    // Si le body est du json, on le parse, sinon on continue
    if (ctx.request.type == 'application/json')
        ctx.body = JSON.parse((await getRawBody(ctx.req, { limit: 1024 })).toString());
    return next();
});

let checkAuth = (auth: string) => {
    if (!auth.toLowerCase().startsWith('bearer ')) {
        return false;
    }
    let token = auth.substr('bearer '.length) as JWT<Identity>;
    if (!token)
        return false;
    let payload = getJWTPayload(token);
    if (!payload.role || !payload.expiration || +Date.now() > payload.expiration) {
        return false;
    }
    return payload;
};

post('/login', 'LoginForm', async (form, ctx) => {
    let auth = ctx.request.get('Authorization') as string | undefined;
    // L'utilisateur a déjà un token, si il est déjà valide, on renvoie success,
    // sinon on continue l'authentification
    if (auth) {
        if (checkAuth(auth)) {
            return;
        }
    }

    if (await noAdmin()) {
        console.log("No admin, creating user...");
        await createUser(form.ident, form.pass, 'admin');
    }

    let user = await getUserByName(form.ident);
    if (!user) {
        ctx.throw(400, 'No such user');
    } 
    if (hashPassword(form.pass, user!.salt.buffer).compare(user!.password.buffer) != 0) {
        ctx.throw(401, 'Authentification failed');
    }
    let val = makeJWT<Identity>({
        role: user!.role,
        expiration: +Date.now() + 1000 * 3600 * 24 * 31 * 6
    });
    json(ctx, val);
});

// À partir d'ici, les accès nécessitent d'être protégés
adminapi.use((ctx, next) => {
    let auth = ctx.get('Authorization') as string | undefined;
    let payload = auth ? checkAuth(auth) : null;
    if (!auth || !payload) {
        ctx.throw(403, 'Not authorized');
        return;
    }
    ctx.state = {
        isAuth: true,
        identity: payload as Required<typeof payload>
    };
    return next();
});

// Les roles fonctionnent en anneau:
// Toutes les permissions d'un role sont le 
// surensemble d'un role de rang inférieur
const roles = ['janny', 'mod', 'dev', 'admin'];

let roleBarrier = (role: string) =>
    (ctx: ApiContext, next: Application.Next) => {
        let auth = ctx.request.get('Authorization') as string | undefined;
        if (auth) {
            // si on est là, alors l'authentification passe...
            let pl = checkAuth(auth) as Required<Identity>;
            if (roles.indexOf(pl.role) >= roles.indexOf(role)) // privilèges assez élevés
                return next();
        }
        ctx.throw(403, 'Not authorized');
    }

adminapi.use(roleBarrier('janny'));
/*
    Permettre la suppression de threads, posts et medias
*/
adminapi.use(roleBarrier('mod'));
/*
    Permettre le ban et l'édition de poste, sticky de thread
*/
adminapi.use(roleBarrier('dev'));
/*
    Permettre la création et l'édition de propriétés de boards
*/

post('/boards', 'BoardSetting',
    settings => createBoard(settings)
);

put('/boards/:name', 'BoardSetting',
    (settings, ctx) => setBoard(ctx.params.name, settings)
);

adminapi.delete('/boards/:name',
    (ctx) => deleteBoard(ctx.params.name)
);

adminapi.use(roleBarrier('admin'));
