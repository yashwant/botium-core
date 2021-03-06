/* eslint-disable no-lone-blocks */
const parse = require('csv-parse/lib/sync')
const _ = require('lodash')
const debug = require('debug')('botium-CompilerXlsx')
const util = require('util')

const Capabilities = require('../Capabilities')
const CompilerBase = require('./CompilerBase')
const Constants = require('./Constants')
const { Convo } = require('./Convo')
const { linesToConvoStep } = require('./helper')

// From, and To texts are identified by separate Question, and Answer columns
const CSV_MODE_QUESTION_ANSWER = 'QUESTION_ANSWER'
// From, and To texts are identified by a special Sender column
const CSV_MODE_ROW_PER_MESSAGE = 'ROW_PER_MESSAGE'
const DEFAULT_SEPARATOR = ','
const DEFAULT_USE_HEADER = true
const DEFAULT_MAPPING_ROW_PER_MESSAGE = {
  conversationId: {
    index: 0,
    cap: Capabilities.SCRIPTING_CSV_MODE_ROW_PER_MESSAGE_COL_CONVERSATION_ID
  },
  sender: {
    index: 1,
    cap: Capabilities.SCRIPTING_CSV_MODE_ROW_PER_MESSAGE_COL_SENDER
  },
  text: {
    index: 2,
    cap: Capabilities.SCRIPTING_CSV_MODE_ROW_PER_MESSAGE_COL_TEXT
  }
}
const DEFAULT_MAPPING_ROW_PER_MESSAGE_1_COLUMN = {
  text: {
    index: 0,
    cap: Capabilities.SCRIPTING_CSV_MODE_ROW_PER_MESSAGE_COL_TEXT
  }
}
// just for quessing, dont has to have all columns, but cant have intersection
// const COLUMNS_JUST_ROW_PER_MESSAGE_MODE = ['conversationId', 'sender', 'text']

const DEFAULT_MAPPING_QUESTION_ANSWER = {
  question: {
    index: 0,
    cap: Capabilities.SCRIPTING_CSV_MODE_QUESTION_ANSWER_COL_QUESTION,
    acceptedColumns: ['question', 'user', 'me']
  },
  answer: {
    index: 1,
    cap: Capabilities.SCRIPTING_CSV_MODE_QUESTION_ANSWER_COL_ANSWER,
    acceptedColumns: ['answer', 'bot']
  }
}
// just for quessing, dont has to have all columns, but cant have intersection
const COLUMNS_JUST_QUESTION_ANSWER_MODE = ['question', 'user', 'me', 'answer', 'bot']

module.exports = class CompilerCsv extends CompilerBase {
  constructor (context, caps = {}) {
    super(context, caps)
  }

  Validate () {
    super.Validate()

    const mode = this._GetOptionalCapability(Capabilities.SCRIPTING_CSV_MODE)
    if (mode) {
      if (mode !== CSV_MODE_ROW_PER_MESSAGE || mode !== CSV_MODE_QUESTION_ANSWER) {
        throw new Error('Illegal value in capability SCRIPTING_CSV_MODE. If it is set then it must be QUESTION_ANSWER or ROW_PER_MESSAGE')
      }
    }
  }

  Compile (scriptBuffer, scriptType = Constants.SCRIPTING_TYPE_CONVO) {
    let rowsRaw
    try {
      rowsRaw = parse(scriptBuffer, {
        delimiter: this._GetOptionalCapability(Capabilities.SCRIPTING_CSV_SEPARATOR, DEFAULT_SEPARATOR)
      })
    } catch (err) {
      throw new Error(`Invalid CSV!\n${util.inspect(err)}`)
    }

    if (rowsRaw.length === 0) {
      return
    }

    const extractedData = {
      rowsRaw,
      header: null,
      rows: null,
      columnCount: null,
      mode: null,
      mapping: {},
      columnMappingMode: null
    }

    // adding header, rows, and columnCount
    {
      if (!rowsRaw.length) {
        debug(`Compile no data`)
        return
      }
      const useHeader = this._GetOptionalCapability(Capabilities.SCRIPTING_CSV_USE_HEADER, DEFAULT_USE_HEADER)
      debug(`Compile use header is ${useHeader}`)
      if (useHeader) {
        extractedData.header = rowsRaw[0]
        extractedData.rows = rowsRaw.slice(1)
      } else {
        extractedData.rows = rowsRaw
      }
      if (!extractedData.rows.length) {
        debug(`Compile just header, no data!`)
        return
      }
      extractedData.columnCount = extractedData.rows[0].length
    }

    // adds mode
    {
      if (this._GetOptionalCapability(Capabilities.SCRIPTING_CSV_MODE)) {
        extractedData.mode = this._GetOptionalCapability(Capabilities.SCRIPTING_CSV_MODE)
      } else if (Object.keys(this._GetCapabilitiesByPrefix('SCRIPTING_CSV_MODE_QUESTION_ANSWER')).length) {
        extractedData.mode = CSV_MODE_QUESTION_ANSWER
      } else if (Object.keys(this._GetCapabilitiesByPrefix('SCRIPTING_CSV_MODE_ROW_PER_MESSAGE')).length) {
        extractedData.mode = CSV_MODE_ROW_PER_MESSAGE
      } else if (extractedData.header) {
        if (extractedData.header.filter(
          (columnName) => {
            return COLUMNS_JUST_QUESTION_ANSWER_MODE.filter(
              (c) => {
                return _equalsFuzzy(c, columnName)
              }).length > 0
          }
        ).length > 0) {
          extractedData.mode = CSV_MODE_QUESTION_ANSWER
        } else {
          extractedData.mode = CSV_MODE_ROW_PER_MESSAGE
        }
      } else {
        extractedData.mode = CSV_MODE_ROW_PER_MESSAGE
      }
      debug(`Compile mode is ${extractedData.mode}`)
    }

    // adds columnMappingMode
    {
      if (Object.keys(this._GetCapabilitiesByPrefix('SCRIPTING_CSV_MODE_QUESTION_ANSWER')).length || Object.keys(this._GetCapabilitiesByPrefix('SCRIPTING_CSV_MODE_ROW_PER_MESSAGE')).length) {
        extractedData.columnMappingMode = 'CAP'
      } else if (extractedData.header) {
        const columnFoundByName = extractedData.header.filter((columnName) => {
          return DEFAULT_MAPPING_ROW_PER_MESSAGE[columnName] || DEFAULT_MAPPING_QUESTION_ANSWER[columnName]
        })
        if (columnFoundByName) {
          extractedData.columnMappingMode = 'NAME'
        }
      }
      if (extractedData.columnMappingMode == null) {
        extractedData.columnMappingMode = 'INDEX'
      }
      debug(`Compile columnMappingMode is ${extractedData.columnMappingMode}`)
    }

    // creates mapping.
    // Examples:
    // {conversationId:0, sender: 1, text: 2 }
    // {sender: 3, text: 2}
    // {question: 2, answer: 4}
    {
      const _getMappingByCap = (header, cap) => {
        cap = this._GetOptionalCapability(cap)
        if (cap === null) {
          return null
        }
        if (cap.toString() === _.toSafeInteger(cap).toString()) {
          return _.toSafeInteger(cap)
        }

        if (header) {
          let result = _getHeaderIndexFuzzy(header, cap)
          if (result != null) {
            return result
          } else {
            throw Error(`Unknown column definition ${cap}. Column not found by name`)
          }
        } else {
          throw Error(`Unknown column definition ${cap}. There is no header in CSV.`)
        }
      }
      const _getMappingByName = (header, defNames) => {
        for (const defName of defNames) {
          let result = _getHeaderIndexFuzzy(header, defName)
          if (result != null) {
            return result
          }
        }
        return null
      }
      const _getMappingByIndex = (def) => {
        return def
      }

      const defMapping = (extractedData.mode === CSV_MODE_ROW_PER_MESSAGE) ? ((extractedData.columnCount > 2) ? DEFAULT_MAPPING_ROW_PER_MESSAGE : DEFAULT_MAPPING_ROW_PER_MESSAGE_1_COLUMN) : DEFAULT_MAPPING_QUESTION_ANSWER

      Object.keys(defMapping).forEach(columnName => {
        const entry = defMapping[columnName]
        let mappedIndex
        switch (extractedData.columnMappingMode) {
          case 'CAP':
            mappedIndex = _getMappingByCap(extractedData.header, entry.cap)
            break
          case 'NAME':
            mappedIndex = _getMappingByName(extractedData.header, defMapping[columnName].acceptedColumns ? defMapping[columnName].acceptedColumns : [columnName])
            break
          case 'INDEX':
            mappedIndex = _getMappingByIndex(entry.index, extractedData.columnCount)
            break
        }
        if (mappedIndex < 0 || mappedIndex >= extractedData.columnCount) {
          throw new Error(`Tried to map column ${columnName}, but the mapped index ${mappedIndex} is invalid in CSV`)
        }
        if (_exists(mappedIndex)) {
          Object.keys(extractedData.mapping).forEach((alreadyMappedColumnName) => {
            if (extractedData.mapping[alreadyMappedColumnName] === mappedIndex) {
              throw new Error(`Tried to map column ${columnName}, but the mapped index ${mappedIndex} is already mapped to ${alreadyMappedColumnName}`)
            }
          })
          extractedData.mapping[columnName] = mappedIndex
        }
      })
    }
    debug(`Compile mapped columns: ${Array.from(Object.keys(extractedData.mapping))}`)

    const scriptResults = []
    // extract scripts
    {
      if (extractedData.mode === CSV_MODE_ROW_PER_MESSAGE) {
        if (_exists(extractedData.mapping['conversationId']) || _exists(extractedData.mapping['sender'])) {
          _checkRequiredMapping(extractedData, 'conversationId', 'sender', 'text')
        } else {
          debug(`Compile one-column sender mode detected`)
          _checkRequiredMapping(extractedData, 'text')
          extractedData.senderModeOneColumn = true
        }

        const _getConversationId = (rowIndex, extractedData) => {
          if (extractedData.senderModeOneColumn) {
            return Math.floor(rowIndex / 2)
          } else {
            return _getCellByMapping(rowIndex, 'conversationId', extractedData)
          }
        }
        const _getSender = (rowIndex, extractedData) => {
          if (extractedData.senderModeOneColumn) {
            return (rowIndex % 2) ? 'bot' : 'me'
          } else {
            const result = _getCellByMapping(rowIndex, 'sender', extractedData)
            if (result !== 'me' && result !== 'bot') {
              throw Error(`Invalid row ${rowIndex} sender must be 'me' or 'bot'`)
            }
            return result
          }
        }
        const _getText = (rowIndex, extractedData) => {
          return _getCellByMapping(rowIndex, 'text', extractedData)
        }

        let currentConvo = null
        let currentConvoId = null
        const _createConvo = (rowIndex) => {
          return new Convo(this.context, {
            header: {
              name: `${currentConvoId}`
            },
            conversation: currentConvo
          })
        }
        for (let rowIndex = 0; rowIndex < extractedData.rows.length; rowIndex++) {
          const convoId = _getConversationId(rowIndex, extractedData)
          if (convoId === null) {
            throw new Error('Convo Id cant be null!')
          }
          // start a new convo, store previous if exists
          if (currentConvoId !== convoId) {
            if (currentConvo != null) {
              scriptResults.push(_createConvo(rowIndex))
            }
            currentConvoId = convoId
            currentConvo = []
          }

          const convoStep = linesToConvoStep(
            [_getText(rowIndex, extractedData)],
            _getSender(rowIndex, extractedData),
            this.context
          )
          convoStep.stepTag = `Row ${rowIndex}`
          currentConvo.push(convoStep)
        }
        if (currentConvo == null || !currentConvo.length) {
          throw new Error('Illegal state, convo can be empty here')
        }
        scriptResults.push(_createConvo(extractedData.rows.length - 1))
      } else if (extractedData.mode === CSV_MODE_QUESTION_ANSWER) {
        _checkRequiredMapping(extractedData, 'question', 'answer')
        for (let rowIndex = 0; rowIndex < extractedData.rows.length; rowIndex++) {
          const convoId = rowIndex
          const currentConvo = []

          const convoStepQuestion = linesToConvoStep(
            [_getCellByMapping(rowIndex, 'question', extractedData)],
            'me',
            this.context
          )
          convoStepQuestion.stepTag = `Question ${rowIndex}`
          currentConvo.push(convoStepQuestion)

          const convoStepAnswer = linesToConvoStep(
            [_getCellByMapping(rowIndex, 'answer', extractedData)],
            'bot',
            this.context
          )
          convoStepAnswer.stepTag = `Answer ${rowIndex}`
          currentConvo.push(convoStepAnswer)

          scriptResults.push(
            new Convo(this.context, {
              header: {
                name: `${convoId}`
              },
              conversation: currentConvo
            })
          )
        }
      } else {
        throw new Error('Illegal state, unknown mode!')
      }
    }

    if (scriptResults && scriptResults.length > 0) {
      if (scriptType === Constants.SCRIPTING_TYPE_CONVO) {
        this.context.AddConvos(scriptResults)
      } else if (scriptType === Constants.SCRIPTING_TYPE_PCONVO) {
        this.context.AddPartialConvos(scriptResults)
      } else if (scriptType === Constants.SCRIPTING_TYPE_UTTERANCES) {
        throw new Error('not supported yet')
      } else if (scriptType === Constants.SCRIPTING_TYPE_SCRIPTING_MEMORY) {
        throw new Error('not supported yet')
      }
      return scriptResults
    }
  }
}

const _getHeaderIndexFuzzy = (header, field) => {
  for (let i = 0; i < header.length; i++) {
    if (_equalsFuzzy(header[i], field)) {
      return i
    }
  }

  return null
}

const _equalsFuzzy = (s1, s2) => {
  return s1.toLocaleLowerCase().trim().replace('_', '').replace('-', '') === s2.toLocaleLowerCase().trim().replace('_', '').replace('-', '')
}

const _getCellByMapping = (row, columnName, extractedData) => {
  const colMapping = extractedData.mapping[columnName]
  return extractedData.rows[row][colMapping]
}

const _checkRequiredMapping = (extractedData, ...columnNames) => {
  for (const columnName of columnNames) {
    if (extractedData.mapping[columnName] == null) {
      throw new Error(`Mapping not found for ${columnName}`)
    }
  }

  if (columnNames.length !== Object.keys(extractedData.mapping).length) {
    throw new Error(`Wrong mapping. Expected: ${columnNames} actual: ${Array.from(Object.keys(extractedData.mapping))}`)
  }
}

const _exists = (value) => {
  return !_.isUndefined(value) && !_.isNull(value)
}
