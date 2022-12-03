import { DocContext } from '../../Basics';
import { Command } from '../../Command';
import { IDocumentData } from '../../Interfaces';
import { DEFAULT_DOC } from '../../Const';

export class Document {
    private _config: IDocumentData;

    private _context: DocContext;

    constructor(config: Partial<IDocumentData>, context: DocContext) {
        this._context = context;
        this._config = { ...DEFAULT_DOC, ...config };
    }

    insertText(text: string): Document {
        const { _context } = this;
        const _commandManager = _context.getCommandManager();
        const insertTextAction = {
            actionName: 'InsertTextAction',
            text,
        };
        const command = new Command(
            {
                DocumentUnit: this,
            },
            insertTextAction
        );
        _commandManager.invoke(command);
        return this;
    }
}
