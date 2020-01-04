export type BasePost = {
    id: number;
    email?: string;
    subject?: string;
    name?: string;
    comment?: string;
    ip: string;
    date: number;
    pass?: Buffer;
};

export type PostWithoutFile = BasePost & { file?: undefined };

export type PostWithFile = BasePost & {
    file: {
        image: Buffer;
        thumbnail: Buffer;
        name: string;
        width: number;
        height: number;
        size: number;
    }
}

interface Poster {
    ip: string;
    last_post_time: number;
    banned: number;
}

export type Thread = {
    sticky: number;
    last_bump: number;
    replies: Post[];
};

export interface Board {
    name: string;
    title: string;
    bump_limit: number;
    worksafe: boolean;
    filesize_limit: number;
    threads: Thread[];
}

export interface User {
    password: Buffer;
    salt: Buffer;
    ident: string;
    role: string;
}

export type Post = PostWithFile | PostWithoutFile;
