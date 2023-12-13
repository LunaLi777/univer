/**
 * Copyright 2023-present DreamNum Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { ICommand, IMutationInfo, IRange } from '@univerjs/core';
import { CommandType, Range } from '@univerjs/core';
import type { IAccessor } from '@wendellhu/redi';

import { rangeMerge } from '../../basics/rangeMerge';
import { createUniqueKey, groupByKey } from '../../basics/utils';
import type { FormatType } from '../../services/numfmt/type';
import { INumfmtService } from '../../services/numfmt/type';

export const factorySetNumfmtUndoMutation = (accessor: IAccessor, option: ISetNumfmtMutationParams) => {
    const numfmtService = accessor.get(INumfmtService);
    const { values, unitId, subUnitId } = option;
    const cells: ISetCellsNumfmt = [];
    const removeCells: IRange[] = [];
    const model = numfmtService.getModel(unitId, subUnitId) || undefined;
    Object.keys(values).forEach((id) => {
        const value = values[id];
        value.ranges.forEach((range) => {
            Range.foreach(range, (row, col) => {
                const oldNumfmt = numfmtService.getValue(unitId, subUnitId, row, col, model);
                if (oldNumfmt) {
                    cells.push({
                        pattern: oldNumfmt.pattern,
                        type: oldNumfmt.type,
                        row,
                        col,
                    });
                } else {
                    removeCells.push({ startColumn: col, endColumn: col, startRow: row, endRow: row });
                }
            });
        });
    });
    const result: Array<IMutationInfo<ISetNumfmtMutationParams | IRemoveNumfmtMutationParams>> = [];
    if (cells) {
        const params = transformCellsToRange(unitId, subUnitId, cells);
        Object.keys(params.values).forEach((key) => {
            const v = params.values[key];
            v.ranges = rangeMerge(v.ranges);
        });
        result.push({
            id: SetNumfmtMutation.id,
            params: transformCellsToRange(unitId, subUnitId, cells),
        });
    }
    if (removeCells) {
        result.push({
            id: RemoveNumfmtMutation.id,
            params: {
                unitId,
                subUnitId,
                ranges: removeCells,
            },
        });
    }
    return result;
};

export interface ISetNumfmtMutationParams {
    values: {
        [id: string]: {
            ranges: IRange[];
        };
    };
    refMap: {
        [id: string]: {
            pattern: string;
            type: FormatType;
        };
    };
    unitId: string;
    subUnitId: string;
}

export const SetNumfmtMutation: ICommand<ISetNumfmtMutationParams> = {
    id: 'sheet.mutation.set.numfmt',
    type: CommandType.MUTATION,
    handler: (accessor: IAccessor, params) => {
        if (!params) {
            return false;
        }
        const { values, refMap } = params;
        const numfmtService = accessor.get(INumfmtService);
        const unitId = params.unitId;
        const sheetId = params.subUnitId;
        const setValues = Object.keys(values).reduce(
            (result, id) => {
                const value = refMap[id];
                const ranges = values[id].ranges;
                if (value) {
                    result.push({
                        ...value,
                        ranges,
                    });
                }
                return result;
            },
            [] as Array<{ pattern: string; type: FormatType; ranges: IRange[] }>
        );
        numfmtService.setValues(unitId, sheetId, setValues);
        return true;
    },
};

export interface IRemoveNumfmtMutationParams {
    ranges: IRange[];
    unitId: string;
    subUnitId: string;
}
export const RemoveNumfmtMutation: ICommand<IRemoveNumfmtMutationParams> = {
    id: 'sheet.mutation.remove.numfmt',
    type: CommandType.MUTATION,
    handler: (accessor: IAccessor, params) => {
        if (!params) {
            return false;
        }
        const { unitId, subUnitId, ranges } = params;
        const numfmtService = accessor.get(INumfmtService);
        numfmtService.deleteValues(unitId, subUnitId, ranges);
        return true;
    },
};
export const factoryRemoveNumfmtUndoMutation = (accessor: IAccessor, option: IRemoveNumfmtMutationParams) => {
    const numfmtService = accessor.get(INumfmtService);
    const { ranges, unitId, subUnitId } = option;
    const cells: ISetCellsNumfmt = [];
    const model = numfmtService.getModel(unitId, subUnitId) || undefined;
    ranges.forEach((range) => {
        Range.foreach(range, (row, col) => {
            const oldNumfmt = numfmtService.getValue(unitId, subUnitId, row, col, model);
            if (oldNumfmt) {
                cells.push({
                    pattern: oldNumfmt.pattern,
                    type: oldNumfmt.type,
                    row,
                    col,
                });
            }
        });
    });
    const params = transformCellsToRange(unitId, subUnitId, cells);
    Object.keys(params.values).forEach((key) => {
        const v = params.values[key];
        v.ranges = rangeMerge(v.ranges);
    });
    return [{ id: SetNumfmtMutation.id, params }];
};
export type ISetCellsNumfmt = Array<{ pattern: string; type: FormatType; row: number; col: number }>;
export const transformCellsToRange = (
    unitId: string,
    subUnitId: string,
    cells: ISetCellsNumfmt
): ISetNumfmtMutationParams => {
    const group = groupByKey(cells, 'pattern');
    const refMap: ISetNumfmtMutationParams['refMap'] = {};
    const values: ISetNumfmtMutationParams['values'] = {};
    const getKey = createUniqueKey();
    Object.keys(group).forEach((pattern) => {
        const groupItem = group[pattern];
        const firstOne = groupItem[0];
        const key = getKey();
        refMap[key] = {
            pattern,
            type: firstOne.type,
        };
        groupItem.forEach((item) => {
            if (!values[key]) {
                values[key] = { ranges: [] };
            }
            values[key].ranges.push(cellToRange(item.row, item.col));
        });
    });
    return { unitId, subUnitId, refMap, values };
};

const cellToRange = (row: number, col: number) =>
    ({
        startRow: row,
        endRow: row,
        startColumn: col,
        endColumn: col,
    }) as IRange;