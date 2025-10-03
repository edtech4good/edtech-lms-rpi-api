/* eslint-disable @typescript-eslint/no-explicit-any */
import { array } from 'check-types';
import { parseISO } from 'date-fns';
// @ts-ignore
import fileExtension from "file-extension";
import { ExtractJwt } from 'passport-jwt';
import { literal, Op, WhereOptions } from "sequelize";
import { FileType } from 'src/models/enums/filetype.enum.';
import { FileMeta } from 'src/models/filemeta.model';
import { IFilter, IMultiFilter, IPaging } from 'src/models/IPaging';
import { replaceAll, stripBom, stripTags, trim } from "voca";
import { Config } from '../config';
import { TokenType } from './../models/enums';

export const jwtoptionsbuilder = (tokenformat: TokenType) => {
  switch (tokenformat) {
    case TokenType.ACCESS:
      return {
        secretOrKey: Config.fortyk.api.rpi.applicationsecret,
        jwtFromRequest: ExtractJwt.fromExtractors([
          ExtractJwt.fromAuthHeaderAsBearerToken(),
          ExtractJwt.fromBodyField(`accesstoken`),
          ExtractJwt.fromUrlQueryParameter(`accesstoken`),
        ]),
      };
  }
};
const cleantext = (text: string) =>
  text
    ? replaceAll(stripBom(stripTags(text)), ' ', '')
    : '';
export const filenameextractor = (filename: string): FileMeta => {
  const actualfilename = cleantext(trim(filename) || 'invalid');
  const actualfilenameext = cleantext(
    fileExtension(actualfilename) || 'invalid'
  );
  let storagefiletype = -1;
  switch (actualfilenameext.toLowerCase()) {
    case 'mp3':
      storagefiletype = FileType.AUDIO;
      break;
    case 'jpg':
    case 'png':
    case 'jpeg':
    case 'gif':
      storagefiletype = FileType.IMAGE;
      break;
    case 'mp4':
      storagefiletype = FileType.VIDEO;
      break;
    default:
      storagefiletype = FileType.INVALID;
  }
  return {
    filename: actualfilename,
    filetype: storagefiletype,
    fileext: actualfilenameext,
  };
};

export const rawfilenameextractor = (filename: string): FileMeta => {
  const actualfilename = (trim(filename) || 'invalid');
  const actualfilenameext = (
    fileExtension(actualfilename) || 'invalid'
  );
  let storagefiletype = -1;
  switch (actualfilenameext.toLowerCase()) {
    case 'mp3':
      storagefiletype = FileType.AUDIO;
      break;
    case 'jpg':
    case 'png':
    case 'jpeg':
    case 'gif':
      storagefiletype = FileType.IMAGE;
      break;
    case 'mp4':
      storagefiletype = FileType.VIDEO;
      break;
    default:
      storagefiletype = FileType.INVALID;
  }
  return {
    filename: actualfilename,
    filetype: storagefiletype,
    fileext: actualfilenameext,
  };
};

export const replacecaseInsensitive = (input: string, find: string) => {
  const reg = new RegExp(find, "gi")
  return input.replace(reg, "");
}

export const buildWhere = <T>(paging: IPaging, basewhere: WhereOptions<T>): WhereOptions<T> => {
  let where = { ...basewhere }
  if (paging.filter && paging.filter.length > 0) {
    where = {
      ...where,
      [Op.and]:
        paging.filter.map((x: IFilter) => {
          if (x.key && x.value) {
            if (x.value.trim().toLowerCase() === "true" || x.value.trim().toLowerCase() === "false") {
              return { [x.key || ""]: (x.value.trim().toLowerCase() === "true") || false }
            } else if (array(x.value)) {
              return {
                [Op.and]: (x.value || []).map(xx => ({ [x.key || ""]: { [Op.like]: literal(`'%${xx.trim()}%'`) } }))
              }
            } else {
              const values = x.value.split(",");
              if (values.length > 0) {
                return {
                  [Op.and]: values.map(xx => ({ [x.key || ""]: { [Op.like]: literal(`'%${xx.trim()}%'`) } }))
                }
              }
            }

          } else {
            return { [x.key || ""]: { [Op.like]: literal(`'%${(x.value || "").trim()}%'`) } }
          }
        })
    };

  }
  return where
}

export const buildCustomWhere = (
  filters: Array<IMultiFilter>,
  wantToSearch: { fields: string, where: any, key?: string }
) => {
  filters.forEach(filter => {
    if((filter.key === wantToSearch.fields || (wantToSearch.key && filter.key === wantToSearch.key)) && filter.value) {
      // if (Object.prototype.hasOwnProperty.call(T, wantToSearch.fields)){
      // }
      wantToSearch.where[wantToSearch.fields] = filter.value;
      const date = parseISO(filter.value as string) ?? null;
      if(date && !isNaN(date.getTime())) {
        wantToSearch.where[wantToSearch.fields] = date;
      }
    }
  });
}
