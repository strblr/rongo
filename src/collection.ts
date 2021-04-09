import {
  ChangeStreamOptions,
  ClientSession,
  Collection as Col,
  CollectionAggregationOptions,
  CollectionInsertManyOptions,
  CommonOptions,
  DbCollectionOptions,
  FindOneAndReplaceOption,
  FindOneAndUpdateOption,
  FindOneOptions,
  GeoHaystackSearchOptions,
  IndexOptions,
  IndexSpecification,
  MongoCountPreferences,
  MongoDistinctPreferences,
  ReadPreferenceOrMode,
  ReplaceOneOptions,
  UpdateManyOptions,
  UpdateQuery,
  WithId
} from "mongodb";
import { isArray, isString } from "lodash";
import {
  createDefaultConfig,
  DeletedKeys,
  DependencyCollector,
  Document,
  FilterQuery,
  findReferences,
  InsertionDoc,
  insertSafely,
  normalizeFilterQuery,
  normalizeInsertionDoc,
  parseSelector,
  propagateDelete,
  RemoveScheduler,
  Rongo,
  Selectable,
  SelectablePromise,
  selectablePromise,
  SelectionOption,
  Selector
} from ".";

// The Collection class

export class Collection<T extends Document> {
  readonly name: string;
  readonly rongo: Rongo;
  readonly handle: Promise<Col<T>>;

  constructor(rongo: Rongo, name: string, options: DbCollectionOptions = {}) {
    this.name = name;
    this.rongo = rongo;
    this.handle = rongo.handle.then(db => db.collection<T>(name, options));
    if (!(name in rongo.graph)) rongo.graph[name] = createDefaultConfig();
  }

  // Meta data :

  get key() {
    return this.rongo.graph[this.name].key;
  }

  get foreignKeys() {
    return this.rongo.graph[this.name].foreignKeys;
  }

  get references() {
    return this.rongo.graph[this.name].references;
  }

  // Query methods :

  select(
    selector: string | Selector,
    selectable: Selectable<T>,
    options?: SelectionOption
  ) {
    if (isString(selector)) selector = parseSelector(selector);
    return selector.resolve(selectable, this, [], options);
  }

  async aggregate<U = T>(
    pipeline: Array<any> = [],
    options?: CollectionAggregationOptions & { baseQuery?: boolean }
  ) {
    const col = await this.handle;
    const [first, ...stages] = pipeline;
    if (first?.$match && !options?.baseQuery)
      pipeline = [
        { $match: await normalizeFilterQuery(this, first.$match) },
        ...stages
      ];
    return col.aggregate<U>(pipeline, options).toArray();
  }

  async count(
    query: FilterQuery<T> = {},
    options?: MongoCountPreferences & { baseQuery?: boolean }
  ) {
    const col = await this.handle;
    const normalized = await normalizeFilterQuery(this, query, options);
    return col.countDocuments(normalized, options);
  }

  async distinct(
    key: string,
    query: FilterQuery<T> = {},
    options?: MongoDistinctPreferences & { baseQuery?: boolean }
  ) {
    const col = await this.handle;
    const normalized = await normalizeFilterQuery(this, query, options);
    return col.distinct(key, normalized, options);
  }

  find(
    query: FilterQuery<T> = {},
    options?: FindOneOptions<T> & { baseQuery?: boolean }
  ) {
    return selectablePromise(this, async () => {
      const col = await this.handle;
      const normalized = await normalizeFilterQuery(this, query, options);
      return col.find(normalized, options as any).toArray();
    });
  }

  findOne(
    query: FilterQuery<T> = {},
    options?: FindOneOptions<T> & { baseQuery?: boolean }
  ) {
    return selectablePromise(this, async () => {
      const col = await this.handle;
      const normalized = await normalizeFilterQuery(this, query, options);
      return col.findOne(normalized, options as object);
    });
  }

  findByKey(key: any, options?: FindOneOptions<T>) {
    return this.findOne({ [this.key]: key } as FilterQuery<T>, {
      ...options,
      baseQuery: true
    });
  }

  findReferences(key: any | Array<any>, options?: { keysOnly?: boolean }) {
    return findReferences(this, isArray(key) ? key : [key], options);
  }

  async geoHaystackSearch(
    x: number,
    y: number,
    options?: GeoHaystackSearchOptions
  ) {
    const col = await this.handle;
    return col.geoHaystackSearch(x, y, options);
  }

  async has(query: FilterQuery<T> = {}, options?: { baseQuery?: boolean }) {
    return Boolean(await this.count(query, { ...options, limit: 1 }));
  }

  hasKey(key: any) {
    return this.has({ [this.key]: key } as FilterQuery<T>, { baseQuery: true });
  }

  async hasAllKeys(keys: Array<any>) {
    return (
      keys.length ===
      (await this.count({ [this.key]: { $in: keys } } as FilterQuery<T>, {
        baseQuery: true
      }))
    );
  }

  async isCapped(options?: { session: ClientSession }) {
    const col = await this.handle;
    return col.isCapped(options);
  }

  async stats(options?: { scale: number; session?: ClientSession }) {
    const col = await this.handle;
    return col.stats(options);
  }

  async watch<U = T>(
    pipeline?: object[],
    options?: ChangeStreamOptions & { session?: ClientSession }
  ) {
    const col = await this.handle;
    return col.watch<U>(pipeline, options);
  }

  // Insert method :

  insert(
    doc: InsertionDoc<T>,
    options?: CollectionInsertManyOptions & { baseDocument?: boolean }
  ): SelectablePromise<WithId<T>>;

  insert(
    docs: Array<InsertionDoc<T>>,
    options?: CollectionInsertManyOptions & { baseDocument?: boolean }
  ): SelectablePromise<Array<WithId<T>>>;

  insert(
    doc: InsertionDoc<T> | Array<InsertionDoc<T>>,
    options?: CollectionInsertManyOptions & { baseDocument?: boolean }
  ): SelectablePromise<WithId<T> | Array<WithId<T>>>;

  insert(
    doc: InsertionDoc<T> | Array<InsertionDoc<T>>,
    options?: CollectionInsertManyOptions & { baseDocument?: boolean }
  ) {
    return selectablePromise(this, async () => {
      const dependencies = new DependencyCollector(this.rongo);
      try {
        return insertSafely(this, doc, dependencies, options);
      } catch (e) {
        await dependencies.delete();
        throw e;
      }
    });
  }

  // Replace methods :

  async replaceOne(
    query: FilterQuery<T>,
    doc: InsertionDoc<T>,
    options?: ReplaceOneOptions & { baseQuery?: boolean }
  ) {
    const col = await this.handle;
    const normalizedQuery = await normalizeFilterQuery(this, query, options);
    const dependencies = new DependencyCollector(this.rongo);
    try {
      const normalizedDoc = await normalizeInsertionDoc(
        this,
        doc,
        dependencies
      );
      return col.replaceOne(normalizedQuery, normalizedDoc as T, options);
    } catch (e) {
      await dependencies.delete();
      throw e;
    }
  }

  replaceByKey(key: any, doc: InsertionDoc<T>, options?: ReplaceOneOptions) {
    return this.replaceOne({ [this.key]: key } as FilterQuery<T>, doc, {
      ...options,
      baseQuery: true
    });
  }

  findOneAndReplace(
    query: FilterQuery<T>,
    doc: InsertionDoc<T>,
    options?: FindOneAndReplaceOption<T> & { baseQuery?: boolean }
  ) {
    return selectablePromise(this, async () => {
      const col = await this.handle;
      const normalizedQuery = await normalizeFilterQuery(this, query, options);
      const dependencies = new DependencyCollector(this.rongo);
      try {
        const normalizedDoc = await normalizeInsertionDoc(
          this,
          doc,
          dependencies
        );
        const result = await col.findOneAndReplace(
          normalizedQuery,
          normalizedDoc,
          options
        );
        return result.value ?? null;
      } catch (e) {
        await dependencies.delete();
        throw e;
      }
    });
  }

  findByKeyAndReplace(
    key: any,
    doc: InsertionDoc<T>,
    options?: FindOneAndReplaceOption<T>
  ) {
    return this.findOneAndReplace({ [this.key]: key } as FilterQuery<T>, doc, {
      ...options,
      baseQuery: true
    });
  }

  // Update methods :

  async update(
    query: FilterQuery<T>,
    update: UpdateQuery<T> | Partial<T>,
    options?: UpdateManyOptions & { multi?: boolean; baseQuery?: boolean }
  ) {
    const col = await this.handle;
    const normalized = await normalizeFilterQuery(this, query, options);
    return col[options?.multi ? "updateMany" : "updateOne"](
      normalized,
      update,
      options
    );
  }

  updateByKey(
    key: any,
    update: UpdateQuery<T> | Partial<T>,
    options?: UpdateManyOptions
  ) {
    return this.update({ [this.key]: key } as FilterQuery<T>, update, {
      ...options,
      baseQuery: true
    });
  }

  findOneAndUpdate(
    query: FilterQuery<T>,
    update: UpdateQuery<T> | T,
    options?: FindOneAndUpdateOption<T> & { baseQuery?: boolean }
  ) {
    return selectablePromise(this, async () => {
      const col = await this.handle;
      const normalized = await normalizeFilterQuery(this, query, options);
      const result = await col.findOneAndUpdate(normalized, update, options);
      return result.value ?? null;
    });
  }

  findByKeyAndUpdate(
    key: any,
    update: UpdateQuery<T> | T,
    options?: FindOneAndUpdateOption<T>
  ) {
    return this.findOneAndUpdate(
      { [this.key]: key } as FilterQuery<T>,
      update,
      { ...options, baseQuery: true }
    );
  }

  // Delete methods :

  async delete(
    query: FilterQuery<T> = {},
    options?: CommonOptions & {
      single?: boolean;
      propagate?: boolean;
      baseQuery?: boolean;
    }
  ) {
    const normalized = await normalizeFilterQuery(this, query, options);
    const scheduler: RemoveScheduler = [];
    const deletedKeys: DeletedKeys = Object.create(null);
    const remover = await propagateDelete(
      this,
      normalized,
      options?.single ?? false,
      options,
      scheduler,
      deletedKeys
    );
    for (const task of scheduler) await task();
    return remover();
  }

  deleteByKey(
    key: any,
    options: CommonOptions & {
      propagate?: boolean;
    }
  ) {
    return this.delete({ [this.key]: key } as FilterQuery<T>, {
      ...options,
      single: true,
      baseQuery: true
    });
  }

  async drop(options?: { session: ClientSession; propagate?: boolean }) {
    const col = await this.handle;
    await this.delete({}, { ...options, baseQuery: true });
    return col.drop();
  }

  findOneAndDelete(
    query: FilterQuery<T>,
    options?: FindOneOptions<T> & {
      propagate?: boolean;
      baseQuery?: boolean;
    }
  ) {
    return selectablePromise(this, async () => {
      const col = await this.handle;
      const normalized = await normalizeFilterQuery(this, query, options);
      const result = await col.findOne(normalized, options as object);
      await this.delete(normalized, {
        ...options,
        single: true,
        baseQuery: true
      });
      return result;
    });
  }

  findByKeyAndDelete(
    key: any,
    options?: FindOneOptions<T> & { propagate?: boolean }
  ) {
    return this.findOneAndDelete({ [this.key]: key } as FilterQuery<T>, {
      ...options,
      baseQuery: true
    });
  }

  // Index methods :

  async createIndex(fieldOrSpec: string | any, options?: IndexOptions) {
    const col = await this.handle;
    return col.createIndex(fieldOrSpec, options);
  }

  async createIndexes(
    indexSpecs: IndexSpecification[],
    options?: { session?: ClientSession }
  ) {
    const col = await this.handle;
    return col.createIndexes(indexSpecs, options);
  }

  async dropIndex(
    indexName: string,
    options?: CommonOptions & { maxTimeMS?: number }
  ) {
    const col = await this.handle;
    return col.dropIndex(indexName, options);
  }

  async dropIndexes(options?: { session?: ClientSession; maxTimeMS?: number }) {
    const col = await this.handle;
    return col.dropIndexes(options);
  }

  async indexes(options?: { session: ClientSession }) {
    const col = await this.handle;
    return col.indexes(options);
  }

  async indexExists(
    indexes: string | string[],
    options?: { session: ClientSession }
  ) {
    const col = await this.handle;
    return col.indexExists(indexes, options);
  }

  async indexInformation(options?: { full: boolean; session: ClientSession }) {
    const col = await this.handle;
    return col.indexInformation(options);
  }

  async listIndexes(options?: {
    batchSize?: number;
    readPreference?: ReadPreferenceOrMode;
    session?: ClientSession;
  }) {
    const col = await this.handle;
    return col.listIndexes(options).toArray();
  }

  async reIndex(options?: { session: ClientSession }) {
    const col = await this.handle;
    return col.reIndex(options);
  }
}
