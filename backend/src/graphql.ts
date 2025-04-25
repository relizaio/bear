
/*
 * -------------------------------------------------------
 * THIS FILE WAS AUTOMATICALLY GENERATED (DO NOT MODIFY)
 * -------------------------------------------------------
 */

/* tslint:disable */
/* eslint-disable */

export abstract class IQuery {
    abstract hello(): Nullable<string> | Promise<Nullable<string>>;
}

export abstract class IMutation {
    abstract resolveSupplier(purl: string): Nullable<Supplier> | Promise<Nullable<Supplier>>;
}

export class Supplier {
    name?: Nullable<string>;
    address?: Nullable<Address>;
    url?: Nullable<Nullable<string>[]>;
    contact?: Nullable<Contact>;
}

export class Address {
    country?: Nullable<string>;
    region?: Nullable<string>;
    locality?: Nullable<string>;
    postOfficeBoxNumber?: Nullable<string>;
    postalCode?: Nullable<string>;
    streetAddress?: Nullable<string>;
}

export class Contact {
    name?: Nullable<string>;
    email?: Nullable<string>;
    phone?: Nullable<string>;
}

type Nullable<T> = T | null;
