import { InMemoryQueryStore } from '../src/query-store';
import { runQueryStoreContractTests } from '../src/query-store.contract';

runQueryStoreContractTests('InMemory', (ttlMs) => new InMemoryQueryStore(ttlMs));
