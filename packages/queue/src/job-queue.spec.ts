import { InMemoryJobQueue } from './job-queue';
import { runJobQueueContractTests } from './job-queue.contract';

runJobQueueContractTests('InMemory', () => new InMemoryJobQueue());
