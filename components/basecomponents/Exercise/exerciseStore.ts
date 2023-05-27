import { fetchRawDictionary, DictionaryDataObject, Phrase, CategoryDataObject } from 'utils/getDataUtils';
import { getCountryVariant, Language } from 'utils/locales';
import { create } from 'zustand';
import {
  createFactoryOfExerciseIdentification,
  ExerciseIdentificationOptions,
  isExerciseAudioIdentification,
  isExerciseTextIdentification,
} from './ExerciseIdentification';
import { sortRandom, getRandomItem } from 'utils/collectionUtils';
import * as R from 'ramda';

/* eslint-disable no-console */

export const CONFIG_BASE = Object.freeze({
  sizeDefault: 10,
  sizeList: [10, 20, 30],
  debugSizeList: [1, 5, 10],
  levelDefault: 0,
  levelMin: 0,
  levelMax: 1,
  levelDownTresholdScore: 50,
  levelUpTresholdScore: 100,
});

const CONFIG_LEVEL0 = Object.freeze({
  wordLimitMin: 1,
  wordLimitMax: 2,
  choiceLimit: 4,
});

const CONFIG_LEVEL1 = Object.freeze({
  wordLimitMin: 2,
  wordLimitMax: 3,
  choiceLimit: 5,
});

const CONFIG_LEVEL2 = Object.freeze({
  wordLimitMin: 2,
  wordLimitMax: 3,
  choiceLimit: 8,
});

export const CONFIG = Object.freeze([
  { ...CONFIG_BASE, ...CONFIG_LEVEL0 },
  { ...CONFIG_BASE, ...CONFIG_LEVEL0, ...CONFIG_LEVEL1 },
  { ...CONFIG_BASE, ...CONFIG_LEVEL0, ...CONFIG_LEVEL1, ...CONFIG_LEVEL2 },
]);

export enum ExerciseStatus {
  active = 'active',
  resolved = 'resolved',
  completed = 'completed',
}

export enum ExerciseType {
  textIdentification = 'textIdentification',
  audioIdentification = 'audioIdentification',
  // TODO: add other types of exercises
}

interface WithId {
  id: number;
}

export interface Choice extends WithId {
  phrase: Phrase;
}

export interface ExerciseResult {
  score: number;
}

export interface Exercise extends WithId {
  type: ExerciseType;
  status: ExerciseStatus;
  choices: Choice[];
  correctChoiceId: number;
  level: number;
  result: ExerciseResult | null;
}

export enum ExerciseStoreStatus {
  uninitialized = 'uninitialized',
  initialized = 'initialized',
  active = 'active',
  completed = 'completed',
}

export interface ExerciseStoreState {
  size: number;
  level: number;
  status: ExerciseStoreStatus;
  lang: { currentLanguage: Language; otherLanguage: Language };
  dictionary: DictionaryDataObject | null;
  categories: CategoryDataObject['id'][];
  history: Exercise[];
  exercise: Exercise | null;
  counter: number;
}

export interface ExerciseStoreActions {
  init: (quickStart?: boolean) => void;
  cleanUp: () => void;
  start: () => void;
  restart: () => void;
  home: () => void;
  nextExercise: () => void;
  exerciseResolved: () => void;
  exerciseCompleted: () => void;
  setExerciseResult: (result: ExerciseResult) => void;
  setCategories: (categories: ExerciseStoreState['categories']) => void;
  setLang: (lang: ExerciseStoreState['lang']) => void;
  setSize: (size: ExerciseStoreState['size']) => void;
  setLevel: (size: ExerciseStoreState['level']) => void;
  uniqId: () => WithId['id'];
}

export interface ExerciseStoreUtils {
  uniqId: () => number;
  nextExercise: ExerciseStoreActions['nextExercise'];
  phraseFilters: {
    equalPhrase: (phraseA: Phrase) => (phraseB: Phrase) => boolean;
    greatPhraseFilter: (
      level: Exercise['level'],
      phrases: Phrase[],
      fallbackPhrases: Phrase[],
      config: { wordLimitMin: number; wordLimitMax: number; choiceLimit: number; levelMin: number }
    ) => Phrase[];
  };
  getFallbackPhrases: () => Phrase[];
}

export const findById = <T>(idToSearch: number, obj: (WithId & T)[]): T => {
  const result = obj.find(({ id }) => id === idToSearch);
  if (result === undefined) throw Error(`choice doesn't not exists`);
  return result;
};

export const resolveMethods: Record<string, (correctChoiceId: number, selectChoices: number[]) => boolean> = {
  // anySelected: (choices) => !!choices.find((choice) => choice.selected),
  oneCorrect: (correctChoiceId, selectedChoices) => selectedChoices.includes(correctChoiceId),
  // allCorrect: (choices) => choices.every((choice) => choice.selected && choice.correct),
};

export const resultMethods: Record<string, (correctChoiceId: number, selectedChoiceId: number[]) => ExerciseResult> = {
  selectedCorrect: (correctChoiceId, selectedChoiceIds) => ({
    // (Math.max(0,selected correct - selected wrong) / all correct) * 100
    score:
      100 *
      Math.max(
        0,
        selectedChoiceIds.filter((id) => correctChoiceId === id).length - selectedChoiceIds.filter((id) => correctChoiceId !== id).length
      ),
  }),
};

/** Describes complete state of the app, enables to save/restore app state */
export const useExerciseStore = create<ExerciseStoreState & ExerciseStoreActions>((set, get) => {
  const uniqId = ((): ExerciseStoreUtils['uniqId'] => {
    let id = 0;
    return () => {
      const out = id;
      id = id + 1;
      return out;
    };
  })();

  const setExerciseResult: ExerciseStoreActions['setExerciseResult'] = (result) => {
    const exercise = getExercise();
    if (exercise.status === ExerciseStatus.active) throw Error('invalid exercise status');
    set({ exercise: { ...exercise, result } });
  };

  const exerciseResolved: ExerciseStoreActions['exerciseResolved'] = () => {
    if (getExercise().status !== ExerciseStatus.active) throw Error('invalid exercise status');
    set(R.over(R.lensPath(['exercise', 'status']), () => ExerciseStatus.resolved));
  };

  const exerciseCompleted: ExerciseStoreActions['exerciseCompleted'] = () => {
    if (getExercise().status !== ExerciseStatus.resolved) throw Error('invalid exercise status');
    if (getExercise().result === null) throw Error('exercise result is empty');
    console.log(`exercise completed`);
    /* set exercise status completed and save exercise */
    set(R.over(R.lensPath(['exercise', 'status']), () => ExerciseStatus.completed));
    set((state) => ({
      history: [...state.history, getExercise()],
    }));
  };

  const nextExercise = () => {
    if (getExercise().status !== ExerciseStatus.completed) throw Error('invalid exercise status');
    if (get().status === ExerciseStoreStatus.completed) throw Error('invalid store status');

    /* check if session is completed */
    if (get().history.length === get().size) {
      console.log(`congrats all exercises completed...`);
      console.log(get().history);
      set({ status: ExerciseStoreStatus.completed });
      return;
    }

    console.log(`generating new exercise for you...`);
    set((state) => ({ exercise: createNextExercise(), counter: state.counter + 1 }));
  };

  const getExercise = () => {
    const exercise = get().exercise;
    if (exercise === null) throw Error('active exercise is null');
    return exercise;
  };

  const getDictionary = () => {
    const dictionary = get().dictionary;
    if (dictionary === null) throw Error(`Dictionary isn't loaded.`);
    return dictionary;
  };

  const getPhrases = (dictionary: DictionaryDataObject, categories: CategoryDataObject['id'][]) => {
    const regex = /[\(,\/]/; // filter phrases containing ( or /
    // TODO: maybe cache results
    return (
      dictionary.categories
        .filter(({ id }) => categories.includes(id))
        .filter(({ phrases }) => phrases.length > 0)
        .map(({ phrases }) => phrases)
        .flat()
        // create phrases
        .map((phraseId) => new Phrase(dictionary.phrases[phraseId]))
        // filter phrases
        .filter(
          (phrase) =>
            phrase.getTranslation(getCurrentLanguage()).match(regex) === null &&
            phrase.getTranslation(getOtherLanguage()).match(regex) === null
        )
    );
  };

  const getFallbackPhrases = () => {
    const dictionary = getDictionary();
    // categories fallback
    const categories = [dictionary.categories[0].id];
    const phrases = getPhrases(dictionary, categories);
    return phrases;
  };

  const getCurrentLanguage = () => get().lang.currentLanguage;
  const getOtherLanguage = () => get().lang.otherLanguage;

  // new better phrase filter :-)
  const greatPhraseFilter: ExerciseStoreUtils['phraseFilters']['greatPhraseFilter'] = (level, phrases, fallbackPhrases, config) => {
    // first it gets random number from range and then accept phrases that have this number of words (in current language)
    const range = config.wordLimitMax - config.wordLimitMin;
    // create Array of filters for all numbers in range
    const filters: ((phrase: Phrase) => boolean)[] = Array(range + 1)
      .fill(0)
      .map((e, i) => i + config.wordLimitMin)
      .map((e) => (phrase: Phrase) => phrase.getTranslation(getCurrentLanguage()).split(' ').length === e)
      // shuffle filters
      .sort(sortRandom);

    const filterPhrases = (filters: ((phrase: Phrase) => boolean)[], phrases: Phrase[]) =>
      filters
        .map((filter) =>
          phrases
            .filter(filter)
            .sort(sortRandom)
            // remove duplicates
            .filter((phrase, index, array) => array.findIndex(phraseFilters.equalPhrase(phrase)) === index)
        )
        .flat();

    let filteredPhrases = filterPhrases(filters, phrases);

    // if it fails then lower level
    if (filteredPhrases.length < config.choiceLimit) {
      // can't lower the level anymore
      if (level === CONFIG_BASE.levelMin) {
        // add fallback phrases
        console.warn('using fallback Phrases');
        const filteredFallbackPhrases = filterPhrases(filters, fallbackPhrases);
        filteredPhrases = [...filteredPhrases, ...filteredFallbackPhrases];
        if (filteredPhrases.length < config.choiceLimit) throw Error('Insuficient phrases to construct the Exercise');
      } else {
        // add phrases from lower level
        filteredPhrases = [
          ...filteredPhrases,
          ...greatPhraseFilter(level - 1, phrases, fallbackPhrases, {
            ...CONFIG[level - 1],
            choiceLimit: config.choiceLimit, // keep current choice limit
          }),
        ];
      }
    }

    // if it fails than tear your hair
    if (filteredPhrases.length < config.choiceLimit) throw Error('Insuficient phrases to construct the Exercise');

    return filteredPhrases.slice(0, config.choiceLimit).sort(sortRandom);
  };

  const phraseFilters: ExerciseStoreUtils['phraseFilters'] = {
    equalPhrase: (a) => (b) => a.getTranslation().toLocaleLowerCase() === b.getTranslation().toLocaleLowerCase(),
    greatPhraseFilter,
  };

  const utils: ExerciseStoreUtils = {
    uniqId,
    nextExercise,
    phraseFilters,
    getFallbackPhrases,
  };

  const createExercise = (type: ExerciseType, options: ExerciseIdentificationOptions): ((phrases: Phrase[]) => Exercise) => {
    const list = {
      [ExerciseType.audioIdentification]: createFactoryOfExerciseIdentification(utils, { ...options, mode: 'audio' }),
      [ExerciseType.textIdentification]: createFactoryOfExerciseIdentification(utils, { ...options, mode: 'text' }),
      // TODO: add other types of exercises
    };
    return list[type];
  };

  const createNextExercise = () => {
    const dictionary = getDictionary();
    // get category phrasesData
    const categories = get().categories;
    if (categories.length === 0) {
      throw Error('None categories selected.');
    }

    // considering to not mix up categories for current exercise, so pick only one from the list
    const phrases = getPhrases(dictionary, [getRandomItem(categories)]);
    // mix categories together
    //const phrases = getPhrases(dictionary, categories);

    const exerciseType = Math.random() > 0.5 ? ExerciseType.textIdentification : ExerciseType.audioIdentification;
    return createExercise(exerciseType, { level: computeLevelForNextExercise(exerciseType, get().history) })(phrases);
  };

  const exerciseFilter: Record<ExerciseType, (ex: Exercise) => boolean> = {
    audioIdentification: isExerciseAudioIdentification,
    textIdentification: isExerciseTextIdentification,
  };

  const computeLevelForNextExercise = (exerciseType: ExerciseType, history: Exercise[]) => {
    const exerciseList = history.filter(exerciseFilter[exerciseType]);
    if (exerciseList.length === 0) return get().level; // if has no exercise of same type return global level
    const exercise = exerciseList.slice(-1)[0];
    if (exercise.result === null) throw Error('result is unexpectedly null');
    const score = exercise.result.score;
    if (score < CONFIG_BASE.levelDownTresholdScore) return Math.max(CONFIG_BASE.levelMin, exercise.level - 1);
    if (score > CONFIG_BASE.levelDownTresholdScore && score < CONFIG_BASE.levelUpTresholdScore) return exercise.level;
    return Math.min(CONFIG_BASE.levelMax, exercise.level + 1);
  };

  return {
    size: CONFIG_BASE.sizeDefault,
    level: CONFIG_BASE.levelDefault,
    status: ExerciseStoreStatus.uninitialized,
    lang: { currentLanguage: getCountryVariant(), otherLanguage: 'uk' },
    dictionary: null,
    categories: [],
    history: [],
    exercise: null,
    counter: 0,
    init: async (quickStart = false) => {
      if (get().dictionary === null) set({ dictionary: await fetchRawDictionary() });
      set({
        history: [],
        exercise: null,
        counter: 0,
        status: ExerciseStoreStatus.initialized,
      });
      if (quickStart === true) get().start();
    },
    cleanUp: () => {
      set({
        status: ExerciseStoreStatus.uninitialized,
        categories: [],
        exercise: null,
        history: [],
        counter: 0,
      });
    },
    start: () => {
      if (get().status === ExerciseStoreStatus.uninitialized) return;
      set({
        status: ExerciseStoreStatus.active,
        exercise: createNextExercise(),
        counter: 1,
      });
    },
    home: () =>
      set({
        exercise: null,
        history: [],
        counter: 0,
        status: ExerciseStoreStatus.initialized,
        categories: [],
      }),
    restart: () =>
      set({
        history: [],
        counter: 1,
        status: ExerciseStoreStatus.active,
        exercise: createNextExercise(),
      }),
    nextExercise,
    exerciseResolved,
    exerciseCompleted,
    setLang: (lang) => set({ lang }),
    setCategories: (categories) => set({ categories }),
    setSize: (size) => set({ size }),
    setLevel: (val) => set({ level: val }),
    setExerciseResult,
    uniqId,
  };
});

export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
