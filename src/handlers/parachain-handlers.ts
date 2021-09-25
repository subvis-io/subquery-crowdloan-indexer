import { SubstrateExtrinsic, SubstrateEvent, SubstrateBlock } from '@subql/types';
import { Balance } from '@polkadot/types/interfaces';
import * as Storage from '../services/storage';
import { Chronicle } from '../types/models/Chronicle';
import { ChronicleKey } from '../constants';
import { parseNumber } from '../utils';
import { CrowdloanStatus } from '../types';

interface ParaInfo {
  manager: string;
  deposit: number;
  locked: boolean;
}

export async function onParachainRegistered(substrateEvent: SubstrateEvent): Promise<void> {
  const { event, block } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: blockNum } = rawBlock.header;

  const [paraId, manager] = event.data.toJSON() as [number, string];
  const { deposit } = ((await api.query.registrar.paras(paraId)).toJSON() as unknown as ParaInfo) || { deposit: 0 };
  const parachain = await Storage.save('Parachain', {
    id: `${paraId}-${manager}`,
    paraId,
    createdAt,
    manager,
    deposit,
    creationBlock: blockNum,
    deregistered: false
  });
  logger.info(`new Parachain saved: ${JSON.stringify(parachain, null, 2)}`);
}

export async function onCrowdloanCreated(substrateEvent: SubstrateEvent) {
  const { event, block, idx } = substrateEvent;
  const { block: rawBlock, timestamp } = block;
  const blockNum = rawBlock.header.number.toNumber();
  const [fundIdx] = event.data.toJSON() as [number];
  await Storage.ensureParachain(fundIdx);
  const fund = await Storage.ensureFund(fundIdx, { blockNum });
  logger.info(`Create Crowdloan: ${JSON.stringify(fund, null, 2)}`);

  const { raised, status } = fund;
  const crowdloanRaisedMemo = {
    id: `${fundIdx}-${blockNum}-${idx}`,
    fundId: fund.id,
    locked: raised,
    status,
    timestamp,
    blockNum
  };
  await Storage.save('CrowdloanRaisedMemo', crowdloanRaisedMemo);
  logger.info(`Save CrowdloanRaisedMemo: ${JSON.stringify(crowdloanRaisedMemo, null, 2)}`);
}

export const onCrowdloanContributed = async (substrateEvent: SubstrateEvent) => {
  const { event, block, idx } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;

  const blockNum = rawBlock.header.number.toNumber();
  const [contributor, fundIdx, amount] = event.data.toJSON() as [string, number, number | string];
  const amtValue = typeof amount === 'string' ? parseNumber(amount) : amount;
  await Storage.ensureParachain(fundIdx);

  logger.info(event.toHuman());

  const fund = await Storage.ensureFund(fundIdx);
  const { raised, status, id: fundId, parachainId } = fund;
  const contribution = {
    id: `${blockNum}-${idx}`,
    account: contributor,
    parachainId,
    fundId,
    amount: amtValue,
    createdAt,
    blockNum
  };

  logger.info(`contribution for ${JSON.stringify(contribution, null, 2)}`);
  await Storage.save('Contribution', contribution);

  const crowdloanRaisedMemo = {
    id: `${fundIdx}-${blockNum}-${idx}`,
    fundId: fund.id,
    locked: raised,
    status,
    timestamp: createdAt,
    blockNum
  };
  await Storage.save('CrowdloanRaisedMemo', crowdloanRaisedMemo);
  logger.info(`Save CrowdloanRaisedMemo: ${JSON.stringify(crowdloanRaisedMemo, null, 2)}`);
};

export const onCrowdloanAllRefunded = async (substrateEvent: SubstrateEvent) => {
  const { event, block, idx } = substrateEvent;
  const { timestamp, block: rawBlock } = block;
  const blockNum = rawBlock.header.number.toNumber();
  const [fundIdx] = event.data.toJSON() as [number];
  const fund = await Storage.ensureFund(fundIdx, {
    status: CrowdloanStatus.RETIRING
  });

  const { id: fundId } = fund;
  const crowdloanRaisedMemo = {
    id: `${fundIdx}-${blockNum}-${idx}`,
    fundId,
    locked: BigInt(0),
    status: CrowdloanStatus.RETIRING,
    timestamp,
    blockNum
  };
  await Storage.save('CrowdloanRaisedMemo', crowdloanRaisedMemo);
  logger.info(`Save CrowdloanRaisedMemo: ${JSON.stringify(crowdloanRaisedMemo, null, 2)}`);
};

export const onCrowdloanDissolved = async (substrateEvent: SubstrateEvent) => {
  const { event, block, idx } = substrateEvent;
  const { timestamp, block: rawBlock } = block;
  const blockNum = rawBlock.header.number.toNumber();
  const [fundIdx] = event.data.toJSON() as [number];
  const fund = await Storage.ensureFund(fundIdx, {
    status: CrowdloanStatus.DISSOLVED,
    isFinished: true,
    updatedAt: timestamp,
    dissolvedBlock: blockNum
  });

  const crowdloanRaisedMemo = {
    id: `${fundIdx}-${blockNum}-${idx}`,
    fundId: fund.id,
    locked: BigInt(0),
    status: CrowdloanStatus.DISSOLVED,
    timestamp,
    blockNum
  };
  await Storage.save('CrowdloanRaisedMemo', crowdloanRaisedMemo);
  logger.info(`Save CrowdloanRaisedMemo: ${JSON.stringify(crowdloanRaisedMemo, null, 2)}`);
};
