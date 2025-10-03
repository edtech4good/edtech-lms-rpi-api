#!/bin/bash
if [ $# -ne 1 ]
  then
    echo "Need one argument!"
    exit 1
fi
npx sequelize-cli migration:create --name $1
latest_file1=$(ls ./build/db/migrations | sort -V | tail -n 1)
mv './build/db/migrations/'$latest_file1 ./src/db/migrations

latest_file2=$(ls ./src/db/migrations | sort -V | tail -n 1)
mv './src/db/migrations/'$latest_file2 './src/db/migrations/'${latest_file2%.*}'.ts'
cp -f migrations-template.txt './src/db/migrations/'${latest_file2%.*}'.ts'